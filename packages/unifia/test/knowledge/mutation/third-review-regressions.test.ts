/* SPDX-License-Identifier: MIT */
/**
 * Cases the third independent review of 80a67268c found. Each one fails on that head and passes once it is fixed.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { recover } from "../../../src/knowledge/mutation/durability.js"
import { LOCK_FILE, VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"
import { VaultSource } from "../../../src/knowledge/source/vault.js"

const WRITER = join(import.meta.dir, "..", "..", "..", "src", "knowledge", "mutation", "writer.ts")
const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const
const ID = "018f1f2e-7a3b-7c4d-8e5f-0123456789ad"

let base: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "unifia-review-r6-"))
  vault = join(base, "project", ".unifia", "memory")
  mkdirSync(join(vault, ".unifia"), { recursive: true })
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function walLine(seq: number, fields: Record<string, unknown>): string {
  return JSON.stringify({
    seq,
    kind: "create",
    locator: "notes/x.md",
    previousHash: null,
    newHash: null,
    auditId: ID,
    source: "test",
    reason: "test",
    timestamp: new Date().toISOString(),
    ...fields,
  })
}

describe("a pipe named like a note does not block a search for a note", () => {
  it.skipIf(process.platform === "win32")("an update of an absent id finishes with a named pipe in the vault", () => {
    mkdirSync(join(vault, "notes"), { recursive: true })
    const made = spawnSync("mkfifo", [join(vault, "notes", "pipe.md")])
    expect(made.status).toBe(0)
    const script = `
      const { VaultMutationWriter } = await import(${JSON.stringify(WRITER)})
      const open = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" }
      try {
        await new VaultMutationWriter({ root: ${JSON.stringify(vault)} }).apply({
          intent: { kind: "update", targetId: ${JSON.stringify(ID)}, expectedVersionHash: "${"0".repeat(64)}",
            newContent: { type: "decision", restrictions: open, body: "b" }, reason: "t", source: "t" },
          reason: "t", source: "t",
        })
      } catch {}
      console.log("finished")
    `
    // A blocked open never returns: the child is stopped by the timeout, and the test fails.
    const run = spawnSync(process.execPath, ["-e", script], { timeout: 20_000, encoding: "utf8" })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain("finished")
  })
})

describe("recovery finishes a temporary of a note whose later entries are a delete or a move", () => {
  it("a delete after a committed write does not discard the write's temporary", () => {
    // The expectation this test used to hold was that the temporary completes over the note, so the failed write's bytes come
    // back after a later delete. That is the defect ADR-092 records as R2. The newest entry for the note is the delete, so the
    // temporary is kept as a conflict and the note stays as it is. The fixture's update also carries a null previousHash, which
    // the writer never records for an update, and the destination holds other bytes: both keep the write from landing.
    const content = "the committed write\n"
    mkdirSync(join(vault, "notes"), { recursive: true })
    writeFileSync(join(vault, "notes", "a.md"), "older version\n")
    writeFileSync(join(vault, "notes", "a.md.unifia-tmp"), content)
    writeFileSync(
      join(vault, WAL_FILE),
      [
        walLine(1, { kind: "update", locator: "notes/a.md", newHash: sha256(content) }),
        walLine(2, { kind: "delete", locator: "notes/a.md", newHash: null }),
      ].join("\n") + "\n",
    )

    const report = recover(vault, WAL_FILE)

    expect(report.completed).toEqual([])
    expect(report.conflicts).toHaveLength(1)
    expect(existsSync(join(vault, "notes", "a.md.unifia-tmp"))).toBe(true)
    expect(readFileSync(join(vault, "notes", "a.md"), "utf8")).toBe("older version\n")
  })
})

describe("a WAL line without a string locator does not fail recovery", () => {
  it("the line is set aside, and the lines beside it are recovered", () => {
    const content = "beside the bad line\n"
    mkdirSync(join(vault, "notes"), { recursive: true })
    writeFileSync(join(vault, "notes", "a.md.unifia-tmp"), content)
    writeFileSync(
      join(vault, WAL_FILE),
      [JSON.stringify({ seq: 1, kind: "create", newHash: "f".repeat(64) }), walLine(2, { locator: "notes/a.md", newHash: sha256(content) })].join("\n") + "\n",
    )

    const report = recover(vault, WAL_FILE)

    expect(report.completed).toHaveLength(1)
    expect(readFileSync(join(vault, "notes", "a.md"), "utf8")).toBe(content)
  })
})

describe("the source of a committed move is kept when no writer died", () => {
  const content = "the moved note\n"

  function setupMove(): void {
    mkdirSync(join(vault, "notes"), { recursive: true })
    writeFileSync(join(vault, "notes", "b.md"), content)
    writeFileSync(join(vault, "notes", "a.md"), content)
    writeFileSync(
      join(vault, WAL_FILE),
      walLine(1, { kind: "move", locator: "notes/b.md", previousLocator: "notes/a.md", newHash: sha256(content) }) + "\n",
    )
  }

  it("recovery without a crash keeps identical bytes written back at the old path", () => {
    setupMove()

    recover(vault, WAL_FILE, { afterCrash: false })

    expect(existsSync(join(vault, "notes", "a.md"))).toBe(true)
  })

  it("a writer opened with no write lock on disk keeps them too", () => {
    setupMove()

    new VaultMutationWriter({ root: vault })

    expect(existsSync(join(vault, "notes", "a.md"))).toBe(true)
  })

  it("a writer opened over a write lock left by a dead writer finishes the unlink", () => {
    setupMove()
    writeFileSync(join(vault, LOCK_FILE), JSON.stringify({ pid: 2_147_483_646, at: new Date().toISOString() }))

    new VaultMutationWriter({ root: vault })

    expect(existsSync(join(vault, "notes", "a.md"))).toBe(false)
  })
})

describe("the reader passes over a note that is not a regular file with one name", () => {
  it("an absent id is not found when a note with a second name is in the vault, and nothing throws", async () => {
    mkdirSync(join(vault, "notes"), { recursive: true })
    const other = join(base, "outside.md")
    writeFileSync(other, "---\nunifia_id: 018f1f2e-7a3b-7c4d-8e5f-0123456789ae\n---\nbody\n")
    linkSync(other, join(vault, "notes", "hl.md"))

    const source = new VaultSource({ root: vault, space: { kind: "personal", id: "writer", label: "writer" } })

    await expect(source.read(undefined, ID as never)).resolves.toBeNull()
  })
})
