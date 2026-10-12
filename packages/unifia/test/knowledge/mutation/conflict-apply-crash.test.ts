/* SPDX-License-Identifier: MIT */
/**
 * An apply interrupted between its steps is finished or undone by the next apply, and no version is lost.
 *
 * The interruption is simulated by a hook that throws after a named step. The state at the throw is the state a crash leaves: the
 * steps before it are durable, the rest did not run. The vault is then reopened (as a restarted process would) and applied again.
 *
 * Requirement 5: a crash between apply's steps is completed or undone by the next apply without data loss, and a second apply of an
 * already applied plan is a no-op. Requirement 8: the conflicted note stays blocked until an apply that was interrupted is finished.
 */

import { describe, it, expect } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { applyConflict, type ApplyStep } from "../../../src/knowledge/admin/conflict-apply.js"
import { listConflicts, planConflict, type KeepChoice } from "../../../src/knowledge/admin/conflicts.js"
import { TMP_SUFFIX } from "../../../src/knowledge/mutation/durability.js"
import {
  ID,
  SimulatedCrash,
  allVaultFiles,
  bytesOf,
  crashedUpdate,
  openWriter,
  sha,
} from "./conflict-fixture.js"

type Case = { keep: KeepChoice; step: ApplyStep; next: "applied" | "finished" | "noop" }

/** Each step of each choice, with what the next apply reports. A step after `completed` leaves nothing to do. */
const CASES: Case[] = [
  { keep: "pending", step: "started", next: "applied" },
  { keep: "pending", step: "preserved", next: "applied" },
  { keep: "pending", step: "committed", next: "finished" },
  { keep: "pending", step: "completed", next: "noop" },
  { keep: "current", step: "started", next: "applied" },
  { keep: "current", step: "preserved", next: "applied" },
  { keep: "current", step: "committed", next: "finished" },
  { keep: "current", step: "completed", next: "noop" },
  { keep: "both", step: "started", next: "applied" },
  { keep: "both", step: "note", next: "applied" },
  { keep: "both", step: "committed", next: "finished" },
  { keep: "both", step: "completed", next: "noop" },
]

/** The identity line is the only line of a kept copy that may differ from the pending bytes. */
const withoutIdentity = (text: string): string => text.replace(/unifia_id: "[^"]+"/, 'unifia_id: "ID"')

describe("a crash between the steps of an apply loses no version", () => {
  for (const c of CASES) {
    it(`keep ${c.keep}: a crash after '${c.step}' is ${c.next === "noop" ? "reported as a no-op" : `${c.next} by the next apply`}`, () => {
      const crash = crashedUpdate()
      const writer = openWriter(crash.root)
      const id = listConflicts(crash.root)[0]?.id as string
      planConflict(crash.root, { id, keep: c.keep })

      expect(() =>
        applyConflict(writer, crash.root, {
          id,
          hooks: {
            afterStep: (step) => {
              if (step === c.step) throw new SimulatedCrash(step)
            },
          },
        }),
      ).toThrow()

      // Nothing is lost at the crash: the owner's edit and the pending bytes are each still in the vault, in the note, the
      // temporary, the preservation folder or the new note.
      const files = allVaultFiles(crash.root)
      expect(files.some((b) => b.equals(Buffer.from(crash.edit)))).toBe(true)
      expect(files.some((b) => withoutIdentity(b.toString("utf8")) === withoutIdentity(crash.pending))).toBe(true)

      // A restarted process opens the vault (which does not finish the apply), and the next apply finishes it or reports it.
      const reopened = openWriter(crash.root)
      const next = applyConflict(reopened, crash.root, { id })
      expect(next.outcome).toBe(c.next)
      expect(listConflicts(crash.root)).toEqual([])

      if (c.keep === "pending") expect(bytesOf(join(crash.root, "n.md"))).toEqual(Buffer.from(crash.pending))
      else expect(bytesOf(join(crash.root, "n.md"))).toEqual(Buffer.from(crash.edit))
      expect(existsSync(join(crash.root, `n.md${TMP_SUFFIX}`))).toBe(false)
    })
  }
})

describe("an interrupted apply keeps the note blocked until it is finished", () => {
  for (const step of ["started", "preserved", "committed"] as const) {
    it(`a write to the note after a crash at '${step}' of keep pending is refused, and apply then unblocks it`, async () => {
      const crash = crashedUpdate()
      const writer = openWriter(crash.root)
      const id = listConflicts(crash.root)[0]?.id as string
      planConflict(crash.root, { id, keep: "pending" })
      expect(() =>
        applyConflict(writer, crash.root, {
          id,
          hooks: {
            afterStep: (s) => {
              if (s === step) throw new SimulatedCrash(s)
            },
          },
        }),
      ).toThrow()

      const reopened = openWriter(crash.root)
      const current = readFileSync(join(crash.root, "n.md"), "utf8")
      await expect(
        reopened.apply({
          intent: {
            kind: "update",
            targetId: ID,
            expectedVersionHash: sha(current),
            newContent: {
              type: "decision",
              restrictions: { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" },
              body: "a write while the apply is open",
            },
            reason: "t",
            source: "t",
          },
          reason: "t",
          source: "t",
        }),
      ).rejects.toMatchObject({ kind: "mutation_refused" })

      applyConflict(reopened, crash.root, { id })
      expect(readFileSync(join(crash.root, "n.md"), "utf8")).toBe(crash.pending)
    })
  }

  it("an interrupted apply whose note no longer holds the planned bytes is not finished, and says why", () => {
    const crash = crashedUpdate()
    const writer = openWriter(crash.root)
    const id = listConflicts(crash.root)[0]?.id as string
    planConflict(crash.root, { id, keep: "pending" })
    expect(() =>
      applyConflict(writer, crash.root, {
        id,
        hooks: {
          afterStep: (s) => {
            if (s === "committed") throw new SimulatedCrash(s)
          },
        },
      }),
    ).toThrow()
    // The owner changes the note after the commit. The temporary is gone, so only the record of the interrupted apply is left.
    const changed = "the owner changed it after the crash\n"
    writeFileSync(join(crash.root, "n.md"), changed)

    const reopened = openWriter(crash.root)
    expect(() => applyConflict(reopened, crash.root, { id })).toThrow(/cannot be verified/)
    expect(readFileSync(join(crash.root, "n.md"), "utf8")).toBe(changed)
  })
})
