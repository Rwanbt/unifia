/* SPDX-License-Identifier: MIT */
/**
 * Guards of the conflict commands: the decisions file, the operator's identity, links in the conflict folder, and identifiers.
 *
 * Requirement 6: every plan and apply is recorded, append-only, with the actor, time, conflict id, choice and hashes; owner-only
 * permissions where the platform has them; no WAL line is removed.
 * Requirement 7: refused when the vault folder or the conflict folder is not owned by the operator, or is writable by others; the
 * operating-system user is recorded.
 * A symbolic link in the conflict folder is refused, never followed.
 */

import { describe, it, expect } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { applyConflict } from "../../../src/knowledge/admin/conflict-apply.js"
import { listConflicts, planConflict } from "../../../src/knowledge/admin/conflicts.js"
import { TMP_SUFFIX } from "../../../src/knowledge/mutation/durability.js"
import { CONFLICTS_DIR, DECISIONS_FILE, currentOperator, readDecisions } from "../../../src/knowledge/mutation/conflict-record.js"
import { bytesOf, crashedUpdate, note, openWriter, refusalOf, sha } from "./conflict-fixture.js"

const POSIX = process.platform !== "win32"

/** A conflict opened by a writer, with the operator's identity as the operating system reports it. */
function openedConflict() {
  const crash = crashedUpdate()
  const writer = openWriter(crash.root)
  const id = listConflicts(crash.root)[0]?.id as string
  return { ...crash, writer, id }
}

/** A directory outside the vault, which a link planted in the conflict folder would lead to. */
function outsideDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "unifia-conflict-outside-"))
  return dir
}

/** An operator who is not the owner of the vault's files. */
const STRANGER = { user: "someone-else", uid: 4242 }

describe("the decisions file records every plan and apply", () => {
  it("records the plan, the refused apply, the replanned apply and the no-op, with actor, time, id, choice and hashes", () => {
    const { root, pending, edit, writer, id } = openedConflict()
    const first = planConflict(root, { id, keep: "pending" })
    const later = note("edited after the plan")
    writeFileSync(join(root, "n.md"), later)
    refusalOf(() => applyConflict(writer, root, { id }))
    const second = planConflict(root, { id, keep: "pending" })
    applyConflict(writer, root, { id })
    applyConflict(writer, root, { id })

    const events = readDecisions(root)
    expect(events.map((e) => e.event)).toEqual([
      "plan",
      "apply-refused",
      "plan",
      "apply-started",
      "apply-completed",
      "apply-noop",
    ])
    expect(events[0]).toMatchObject({
      event: "plan",
      conflictId: id,
      planId: first.planId,
      keep: "pending",
      locator: "n.md",
      operation: "update",
      seq: 2,
      currentHash: sha(edit),
      pendingHash: sha(pending),
      actor: { user: currentOperator().user },
    })
    expect(events[1]).toMatchObject({ event: "apply-refused", conflictId: id, planId: first.planId })
    expect(String(events[1]?.reason)).toMatch(/changed since the plan/)
    expect(events[2]).toMatchObject({ event: "plan", planId: second.planId, currentHash: sha(later) })
    expect(events[3]).toMatchObject({ event: "apply-started", planId: second.planId, currentHash: sha(later) })
    expect(events[4]).toMatchObject({ event: "apply-completed", planId: second.planId, pendingHash: sha(pending) })
    expect(events[5]).toMatchObject({ event: "apply-noop", planId: second.planId })
    for (const e of events) {
      expect(e.conflictId).toBe(id)
      expect(Number.isFinite(Date.parse(String(e.at)))).toBe(true)
      expect(e.actor).toEqual(currentOperator())
    }
  })

  it("the decisions file is append-only: an earlier decision is a prefix of the file after a later one", () => {
    const { root, writer, id } = openedConflict()
    planConflict(root, { id, keep: "current" })
    const before = readFileSync(join(root, DECISIONS_FILE), "utf8")
    applyConflict(writer, root, { id })
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8").startsWith(before)).toBe(true)
  })

  it("the decisions file and its folder are owner-only where the platform has permissions", () => {
    if (!POSIX) return
    const { root, id } = openedConflict()
    planConflict(root, { id, keep: "pending" })
    expect(statSync(join(root, DECISIONS_FILE)).mode & 0o777).toBe(0o600)
    expect(statSync(join(root, CONFLICTS_DIR)).mode & 0o777).toBe(0o700)
  })

  it("a plan that names the new note's place records that place and the new note's hash", () => {
    const { root, id } = openedConflict()
    const plan = planConflict(root, { id, keep: "both" })
    expect(plan.keepLocator).toBe(`n (conflict ${id.slice(0, 8)}).md`)
    expect(readDecisions(root).at(-1)).toMatchObject({ event: "plan", keepLocator: plan.keepLocator, newNoteHash: plan.newNoteHash })
  })
})

describe("identity and permissions of the operator", () => {
  it("the operating-system user is the actor the commands record", () => {
    expect(currentOperator().user).toBe(userInfo().username)
  })

  it("a vault whose folder is not owned by the operator is refused by list, plan and apply", () => {
    if (!POSIX) return
    const { root, edit, writer, id } = openedConflict()
    expect(refusalOf(() => listConflicts(root, STRANGER)).message).toMatch(/not owned by this user/)
    expect(refusalOf(() => planConflict(root, { id, keep: "pending", operator: STRANGER })).message).toMatch(/not owned by this user/)
    planConflict(root, { id, keep: "pending" })
    const refused = refusalOf(() => applyConflict(writer, root, { id, operator: STRANGER }))
    expect(refused.message).toMatch(/not owned by this user/)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(edit)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(true)
  })

  it("a conflict folder writable by others is refused, and the refusal names no path", () => {
    if (!POSIX) return
    const { root, id } = openedConflict()
    chmodSync(join(root, CONFLICTS_DIR), 0o777)
    try {
      const refused = refusalOf(() => planConflict(root, { id, keep: "pending" }))
      expect(refused.message).toMatch(/writable by others/)
      expect(refused.message).not.toContain(root)
      expect(refusalOf(() => listConflicts(root)).message).toMatch(/writable by others/)
    } finally {
      chmodSync(join(root, CONFLICTS_DIR), 0o700)
    }
  })

  it("a vault folder writable by others is refused", () => {
    if (!POSIX) return
    const { root, id } = openedConflict()
    chmodSync(root, 0o777)
    try {
      expect(refusalOf(() => planConflict(root, { id, keep: "pending" })).message).toMatch(/writable by others/)
    } finally {
      chmodSync(root, 0o755)
    }
  })
})

describe("a symbolic link in the conflict folder is refused, not followed", () => {
  it("a record folder that is a link is refused by plan, and the target is not written", () => {
    const { root, id } = openedConflict()
    const target = outsideDir()
    rmSync(join(root, CONFLICTS_DIR, id), { recursive: true, force: true })
    symlinkSync(target, join(root, CONFLICTS_DIR, id), "dir")
    expect(refusalOf(() => planConflict(root, { id, keep: "pending" })).kind).toBe("mutation_refused")
    expect(readdirSync(target)).toEqual([])
    rmSync(target, { recursive: true, force: true })
  })

  it("a record folder replaced by a link after the plan is refused by apply before anything changes", () => {
    const { root, edit, writer, id } = openedConflict()
    planConflict(root, { id, keep: "pending" })
    const target = outsideDir()
    rmSync(join(root, CONFLICTS_DIR, id), { recursive: true, force: true })
    symlinkSync(target, join(root, CONFLICTS_DIR, id), "dir")
    expect(refusalOf(() => applyConflict(writer, root, { id })).kind).toBe("mutation_refused")
    expect(readdirSync(target)).toEqual([])
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(edit)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(true)
    rmSync(target, { recursive: true, force: true })
  })

  it("a decisions file that is a link is refused by list and plan, and the target is not written", () => {
    const { root, id } = openedConflict()
    const target = join(outsideDir(), "outside.txt")
    writeFileSync(target, "kept outside\n")
    symlinkSync(target, join(root, DECISIONS_FILE))
    expect(refusalOf(() => listConflicts(root)).kind).toBe("mutation_refused")
    expect(refusalOf(() => planConflict(root, { id, keep: "pending" })).kind).toBe("mutation_refused")
    expect(readFileSync(target, "utf8")).toBe("kept outside\n")
  })

  it("a preservation folder that is a link is refused by apply, and the note and the temporary are kept", () => {
    const { root, pending, edit, writer, id } = openedConflict()
    planConflict(root, { id, keep: "pending" })
    const target = outsideDir()
    mkdirSync(join(root, CONFLICTS_DIR, id), { recursive: true })
    symlinkSync(target, join(root, CONFLICTS_DIR, id, "preserved"), "dir")
    expect(() => applyConflict(writer, root, { id })).toThrow()
    expect(readdirSync(target)).toEqual([])
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(edit)
    expect(bytesOf(join(root, `n.md${TMP_SUFFIX}`))).toEqual(Buffer.from(pending))
    rmSync(target, { recursive: true, force: true })
  })
})

describe("identifiers", () => {
  it("an identifier that is not a conflict id is refused before any path is built from it", () => {
    const { root } = openedConflict()
    for (const bad of ["../../wal.jsonl", "ABCDEF0123456789", "0123", "0123456789abcdef/../x"]) {
      expect(refusalOf(() => planConflict(root, { id: bad, keep: "pending" })).message).toMatch(/not a conflict id/)
    }
  })

  it("an unknown choice is refused at plan time", () => {
    const { root, id } = openedConflict()
    expect(refusalOf(() => planConflict(root, { id, keep: "both-and-neither" as never })).message).toMatch(/keep must be/)
  })
})

describe("the command is wired into the knowledge CLI", () => {
  it("the dispatcher knows the conflicts group, and a missing action is a usage error", async () => {
    const main = readFileSync(join(import.meta.dir, "..", "..", "..", "src", "cli", "knowledge", "main.ts"), "utf8")
    expect(main).toContain('case "conflicts":')
    const { runKnowledgeCli } = await import("../../../src/cli/knowledge/main.js")
    expect(await runKnowledgeCli(["conflicts"])).toBe(2)
  })
})
