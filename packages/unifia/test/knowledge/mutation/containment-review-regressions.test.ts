/* SPDX-License-Identifier: MIT */
/**
 * Regressions from the independent review of the containment head (ADR-092, "Independent review of head 75264c717" and the
 * follow-up on 43a46b550). Each describe names the defect it pins. Each one fails on 43a46b550 and passes once its fix is in.
 *
 * Crash fixtures are states a real crash can leave: a temporary beside a destination that still holds the pre-write bytes
 * (an atomic rename has not landed), a WAL line for the write, and a write lock whose owner is dead.
 */

import { afterEach, describe, it, expect } from "bun:test"
import { createHash } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TMP_SUFFIX, WriteLock, appendLineDurable, writeFileDurable } from "../../../src/knowledge/mutation/durability.js"
import { LOCK_FILE, TRASH_DIR, VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"

const WRITER = join(import.meta.dir, "..", "..", "..", "src", "knowledge", "mutation", "writer.ts")
const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const
const ID = "0190d2c0-7b00-7000-8000-000000000001"
/** A pid the kernel cannot have allocated: its holder is verifiably dead. */
const DEAD_PID = 2_147_483_646

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex")

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A vault root with its own folder, in a fresh directory that the test removes afterwards. */
function freshVault(): string {
  const base = mkdtempSync(join(tmpdir(), "unifia-containment-"))
  made.push(base)
  const root = join(base, "vault")
  mkdirSync(join(root, ".unifia"), { recursive: true })
  return root
}

/** A note with valid frontmatter for ID, and the given body. */
function note(body: string, id: string = ID): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "${id}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "candidate"',
    'unifia_created_at: "2026-08-31T00:00:00Z"',
    'unifia_updated_at: "2026-08-31T00:00:00Z"',
    'unifia_project_ref: "test"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "---",
    body,
    "",
  ].join("\n")
}

/** One WAL line, as the writer records it. */
function walLine(seq: number, fields: Record<string, unknown>): string {
  return JSON.stringify({
    seq,
    kind: "update",
    auditId: `audit-${seq}`,
    source: "test",
    reason: "test",
    timestamp: "2026-08-31T00:00:00Z",
    ...fields,
  })
}

/** The lock a writer leaves when it dies mid-commit. */
function plantDeadLock(root: string): void {
  writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: DEAD_PID, at: new Date().toISOString() }))
}

function updateIntent(id: string, expected: string, body: string) {
  return {
    intent: {
      kind: "update",
      targetId: id,
      expectedVersionHash: expected,
      newContent: { type: "decision", restrictions: OPEN, body },
      reason: "test",
      source: "test",
    },
    reason: "test",
    source: "test",
  }
}

// Root cause (L2): the lock holder is read with a plain readFileSync. A named pipe at the lock path is opened for reading
// and blocks until a writer appears, so apply() never returns. Fix: read the lock through readNoFollow, which opens without
// blocking, and treat any non-regular lock as held.

describe("L2: a named pipe at the write lock path does not block the writer", () => {
  it.skipIf(process.platform === "win32")("the open and a create both return with a pipe at the lock path", () => {
    const root = freshVault()
    expect(spawnSync("mkfifo", [join(root, LOCK_FILE)]).status).toBe(0)
    const script = `
      const { VaultMutationWriter } = await import(${JSON.stringify(WRITER)})
      const open = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" }
      const writer = new VaultMutationWriter({ root: ${JSON.stringify(root)} })
      console.log("opened")
      try {
        await writer.apply({
          intent: { kind: "create", targetLocator: "n.md", newContent: { type: "decision", restrictions: open, body: "b" }, reason: "t", source: "t" },
          reason: "t", source: "t",
        })
      } catch {}
      console.log("finished")
    `
    // A blocked read never returns: the timeout stops the child, and the "finished" line is missing.
    const run = spawnSync(process.execPath, ["-e", script], { timeout: 20_000, encoding: "utf8" })
    expect(run.stdout).toContain("finished")
    expect(existsSync(join(root, "n.md"))).toBe(false)
  })
})

// Root cause (R1): recovery renames a pending temporary over the destination whenever the WAL names the note, without
// checking what the destination holds. A user edit made after the crash is replaced. Fix: complete the rename only when the
// destination is absent (create, restore, move) or holds the previous bytes the write replaced (update); a destination holding
// anything else leaves the temporary and the WAL in place and is reported as a conflict.

describe("R1: recovery does not write over a destination that holds other bytes", () => {
  it("a user edit made after the crash survives the open and the next open, and the pending write is kept as a conflict", () => {
    const root = freshVault()
    const before = note("old")
    const pending = note("pending agent write")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    plantDeadLock(root)
    writeFileSync(join(root, "n.md"), note("USER EDIT after the crash"))

    const first = new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "n.md"), "utf8")).toContain("USER EDIT after the crash")
    expect(first.recovery().completed).toEqual([])
    expect(first.recovery().conflicts).toHaveLength(1)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(true)

    new VaultMutationWriter({ root })
    expect(readFileSync(join(root, "n.md"), "utf8")).toContain("USER EDIT after the crash")
  })

  it("a crash before the rename completes an update whose destination still holds the previous bytes", () => {
    const root = freshVault()
    const before = note("old")
    const pending = note("pending agent write")
    writeFileSync(join(root, "n.md"), before)
    writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
    appendLineDurable(
      join(root, WAL_FILE),
      walLine(1, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
    )
    plantDeadLock(root)

    const writer = new VaultMutationWriter({ root })
    expect(writer.recovery().completed).toHaveLength(1)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(pending)
    expect(existsSync(join(root, `n.md${TMP_SUFFIX}`))).toBe(false)
  })
})
