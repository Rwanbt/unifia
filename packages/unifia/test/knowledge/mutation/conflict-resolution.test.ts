/* SPDX-License-Identifier: MIT */
/**
 * Two-step resolution of a conflict: `plan` records the owner's choice with the hashes it was made against, and `apply` executes
 * it only while those hashes still hold.
 *
 * Requirement 3: no resolution deletes content; the version not kept is moved into the conflict's preservation folder.
 * Requirement 4: plan records the choice and hashes; apply refuses when either changed.
 * Requirement 5 (second apply): applying the same plan twice is a no-op that reports it.
 * Requirement 8: writes to the conflicted note are refused until apply; writes to another note succeed.
 */

import { describe, it, expect } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { applyConflict } from "../../../src/knowledge/admin/conflict-apply.js"
import { listConflicts, planConflict } from "../../../src/knowledge/admin/conflicts.js"
import { doctor } from "../../../src/knowledge/admin/doctor.js"
import { TMP_SUFFIX, appendLineDurable, writeFileDurable } from "../../../src/knowledge/mutation/durability.js"
import { WAL_FILE, pendingWriteConflicts } from "../../../src/knowledge/mutation/writer.js"
import { readDecisions } from "../../../src/knowledge/mutation/conflict-record.js"
import {
  ID,
  bytesOf,
  crashedUpdate,
  openWriter,
  refusalOf,
  sha,
  walLine,
} from "./conflict-fixture.js"

/** An update intent for the note `ID`, planned on `expected`. */
function updateOn(expected: string, body: string) {
  return {
    intent: {
      kind: "update",
      targetId: ID,
      expectedVersionHash: expected,
      newContent: {
        type: "decision",
        restrictions: { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" },
        body,
      },
      reason: "test",
      source: "test",
    },
    reason: "test",
    source: "test",
  }
}

/** The one conflict of a crashed vault, opened by a writer. */
function openedConflict() {
  const crash = crashedUpdate()
  const writer = openWriter(crash.root)
  const id = listConflicts(crash.root)[0]?.id as string
  return { ...crash, writer, id }
}

describe("keep the pending version", () => {
  it("the note holds the pending bytes, and the owner's edit is preserved byte for byte", () => {
    const { root, pending, edit, writer, id } = openedConflict()
    const plan = planConflict(root, { id, keep: "pending" })
    expect(plan.keep).toBe("pending")

    const out = applyConflict(writer, root, { id })
    expect(out.outcome).toBe("applied")
    expect(bytesOf(join(root, "n.md"))).toEqual(Buffer.from(pending))
    expect(out.preserved).toEqual([`.unifia/conflicts/${id}/preserved/current-${sha(edit)}.md`])
    expect(bytesOf(join(root, out.preserved[0] as string))).toEqual(Buffer.from(edit))
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
    expect(listConflicts(root)).toEqual([])
  })

  it("the log is not changed: the pending entry stays, and no line is added", () => {
    const { root, writer, id } = openedConflict()
    const before = readFileSync(join(root, WAL_FILE), "utf8")
    planConflict(root, { id, keep: "pending" })
    applyConflict(writer, root, { id })
    expect(readFileSync(join(root, WAL_FILE), "utf8")).toBe(before)
  })
})

describe("keep the current version", () => {
  it("the note keeps the owner's edit, and the pending bytes are preserved byte for byte", () => {
    const { root, pending, edit, writer, id } = openedConflict()
    planConflict(root, { id, keep: "current" })

    const out = applyConflict(writer, root, { id })
    expect(out.outcome).toBe("applied")
    expect(bytesOf(join(root, "n.md"))).toEqual(Buffer.from(edit))
    expect(out.preserved).toEqual([`.unifia/conflicts/${id}/preserved/pending-${sha(pending)}.md`])
    expect(bytesOf(join(root, out.preserved[0] as string))).toEqual(Buffer.from(pending))
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
    expect(listConflicts(root)).toEqual([])
  })

  it("the log is not changed by this choice either", () => {
    const { root, writer, id } = openedConflict()
    const before = readFileSync(join(root, WAL_FILE), "utf8")
    planConflict(root, { id, keep: "current" })
    applyConflict(writer, root, { id })
    expect(readFileSync(join(root, WAL_FILE), "utf8")).toBe(before)
  })
})

describe("keep both: the pending version becomes a note of its own", () => {
  it("the note keeps the owner's edit, and the new note holds the pending bytes with a new identity", () => {
    const { root, pending, edit, writer, id } = openedConflict()
    planConflict(root, { id, keep: "both" })

    const out = applyConflict(writer, root, { id })
    expect(out.outcome).toBe("applied")
    expect(bytesOf(join(root, "n.md"))).toEqual(Buffer.from(edit))
    expect(out.newLocator).toMatch(/^n \(conflict [0-9a-f]{8}\)\.md$/)
    const copy = readFileSync(join(root, out.newLocator as string), "utf8")
    const newId = /unifia_id: "([^"]+)"/.exec(copy)?.[1] as string
    expect(newId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(newId).not.toBe(ID)
    // Only the identity line differs from the pending bytes: the body and the rest of the frontmatter are the same.
    expect(copy.replace(`unifia_id: "${newId}"`, `unifia_id: "${ID}"`)).toBe(pending)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
  })

  it("the new note is a create in the log, recorded like any other write, and earlier lines are kept", () => {
    const { root, writer, id } = openedConflict()
    const before = readFileSync(join(root, WAL_FILE), "utf8")
    planConflict(root, { id, keep: "both" })
    const out = applyConflict(writer, root, { id })
    const after = readFileSync(join(root, WAL_FILE), "utf8")
    expect(after.startsWith(before)).toBe(true)
    const added = after.slice(before.length).trim().split("\n").map((l) => JSON.parse(l))
    expect(added).toEqual([
      expect.objectContaining({
        kind: "create",
        locator: out.newLocator,
        previousHash: null,
        newHash: sha(readFileSync(join(root, out.newLocator as string))),
      }),
    ])
  })

  it("a plan can name the new note's place, and a place that is taken is refused at plan time", () => {
    const { root, id } = openedConflict()
    writeFileSync(join(root, "taken.md"), "occupied")
    expect(refusalOf(() => planConflict(root, { id, keep: "both", as: "taken.md" })).message).toMatch(/already/)
    expect(refusalOf(() => planConflict(root, { id, keep: "both", as: "../escape.md" })).kind).toBe("mutation_refused")
    expect(refusalOf(() => planConflict(root, { id, keep: "both", as: ".unifia/x.md" })).kind).toBe("mutation_refused")
  })
})

describe("apply refuses when anything changed since the plan", () => {
  it("a destination edited after the plan refuses the apply, and the conflict stays", () => {
    const { root, pending, writer, id } = openedConflict()
    planConflict(root, { id, keep: "pending" })
    const later = "---\nunifia_id: \"" + ID + "\"\n---\nedited again after the plan\n"
    writeFileSync(join(root, "n.md"), later)

    const refused = refusalOf(() => applyConflict(writer, root, { id }))
    expect(refused.kind).toBe("mutation_refused")
    expect(refused.message).toMatch(/changed since the plan/)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(later)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(true)
    expect(readDecisions(root).at(-1)).toMatchObject({ event: "apply-refused" })

    // Planned again on the bytes as they now are, the apply goes through, and the edit is preserved.
    const replanned = planConflict(root, { id, keep: "pending" })
    expect(replanned.currentHash).toBe(sha(later))
    applyConflict(writer, root, { id })
    expect(bytesOf(join(root, "n.md"))).toEqual(Buffer.from(pending))
    expect(bytesOf(join(root, `.unifia/conflicts/${id}/preserved/current-${sha(later)}.md`))).toEqual(Buffer.from(later))
  })

  it("a temporary whose bytes changed after the plan refuses the apply, and nothing is removed", () => {
    const { root, edit, writer, id } = openedConflict()
    planConflict(root, { id, keep: "current" })
    const tampered = "tampered temporary\n"
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), tampered)

    const refused = refusalOf(() => applyConflict(writer, root, { id }))
    expect(refused.message).toMatch(/since the plan/)
    expect(readFileSync(join(root, `n.md${TMP_SUFFIX}`), "utf8")).toBe(tampered)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(edit)
  })

  it("a later log entry for the note after the plan refuses the apply", () => {
    const { root, edit, writer, id } = openedConflict()
    planConflict(root, { id, keep: "current" })
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(3, { kind: "delete", locator: "n.md", previousHash: sha(edit), newHash: null }),
    )
    const refused = refusalOf(() => applyConflict(writer, root, { id }))
    expect(refused.message).toMatch(/since the plan/)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(true)
  })

  it("an apply with no plan is refused, and names what to do", () => {
    const { root, writer, id } = openedConflict()
    expect(refusalOf(() => applyConflict(writer, root, { id })).message).toMatch(/no plan/)
  })
})

describe("the same plan applied twice", () => {
  it("the second apply is a no-op that reports it, and the vault does not change", () => {
    const { root, writer, id } = openedConflict()
    const plan = planConflict(root, { id, keep: "current" })
    const first = applyConflict(writer, root, { id })
    const snapshot = readFileSync(join(root, "n.md"))
    const second = applyConflict(writer, root, { id })
    expect(first.outcome).toBe("applied")
    expect(second).toMatchObject({ outcome: "noop", planId: plan.planId })
    expect(readFileSync(join(root, "n.md"))).toEqual(snapshot)
    expect(readDecisions(root).at(-1)).toMatchObject({ event: "apply-noop", planId: plan.planId })
  })
})

describe("writes to the conflicted note are refused until apply; other notes are unaffected", () => {
  it("an update, a move and a delete of the conflicted note are refused, and a create elsewhere succeeds", async () => {
    const { root, edit, writer } = openedConflict()
    await expect(writer.apply(updateOn(sha(edit), "a write on the edited bytes"))).rejects.toMatchObject({
      kind: "mutation_refused",
      message: expect.stringContaining("did not complete"),
    })
    await expect(
      writer.apply({
        intent: { kind: "move", targetId: ID, targetLocator: "moved.md", expectedVersionHash: sha(edit), reason: "t", source: "t" },
        reason: "t",
        source: "t",
      }),
    ).rejects.toMatchObject({ kind: "mutation_refused" })
    await expect(
      writer.apply({
        intent: { kind: "delete", targetId: ID, expectedVersionHash: sha(edit), reason: "t", source: "t" },
        reason: "t",
        source: "t",
      }),
    ).rejects.toMatchObject({ kind: "mutation_refused" })

    const created = await writer.apply({
      intent: {
        kind: "create",
        targetLocator: "other.md",
        newContent: {
          type: "decision",
          restrictions: { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" },
          body: "another note",
        },
        reason: "t",
        source: "t",
      },
      reason: "t",
      source: "t",
    })
    expect(created.applied).toBe(true)
    expect(bytesOf(join(root, "n.md"))).toEqual(Buffer.from(edit))
  })

  it("after apply the note accepts writes again", async () => {
    const { root, edit, writer, id } = openedConflict()
    planConflict(root, { id, keep: "current" })
    applyConflict(writer, root, { id })
    const result = await writer.apply(updateOn(sha(edit), "written after the resolution"))
    expect(result.applied).toBe(true)
  })
})

describe("the doctor lists the conflict until it is resolved", () => {
  it("pending conflicts name the note, and no finding remains after apply", () => {
    const { root, writer, id } = openedConflict()
    const listed = (): string[] => pendingWriteConflicts(root)
    const finding = (pending: string[]) =>
      doctor({
        byId: new Map(),
        knownLocators: new Set(),
        edges: [],
        index: { rebuiltAt: new Date().toISOString(), candidatesCount: 0 },
        indexedLocators: new Set(),
        pendingConflicts: pending as never,
      }).findings
    expect(listed()).toEqual(["n.md"])
    expect(finding(listed())).toEqual([expect.objectContaining({ category: "pending_conflict", locator: "n.md" })])

    planConflict(root, { id, keep: "pending" })
    applyConflict(writer, root, { id })
    expect(listed()).toEqual([])
    expect(finding(listed())).toEqual([])
  })
})
