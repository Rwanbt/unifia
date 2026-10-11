/* SPDX-License-Identifier: MIT */
/**
 * A second name for a file, and the vault's own folder.
 *
 * A hard link is a second name for the same bytes: a write through it lands in the file outside the vault, and a read of
 * a log through it returns nothing at all. The vault's bookkeeping folder is not a place a note, a recovered temporary or
 * a recovered move may go. Each case checks what is refused, and that nothing outside the vault changed.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendLineDurable,
  readWalTolerant,
  recover,
} from "../../../src/knowledge/mutation/durability.js"
import { VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"
import { PersistentEgressAudit } from "../../../src/knowledge/policy/control-log.js"

const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const
const ID = "00000000-0000-4000-8000-0000000000c1"

let base: string
let outside: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "unifia-second-name-"))
  outside = join(base, "outside")
  vault = join(base, "project", ".unifia", "memory")
  mkdirSync(outside)
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

describe("a write-ahead log with a second name is not read as empty, and nothing is written through it", () => {
  it("a log that is a hard link to a file outside is refused on open, and both files are unchanged", () => {
    const wal = join(vault, WAL_FILE)
    writeFileSync(wal, `${walLine(1, { newHash: sha256("a") })}\n`)
    const snapshot = join(outside, "wal-snapshot.jsonl")
    linkSync(wal, snapshot)
    const before = readFileSync(wal, "utf8")

    expect(() => readWalTolerant(wal)).toThrow()
    expect(() => new VaultMutationWriter({ root: vault })).toThrow()
    expect(readFileSync(wal, "utf8")).toBe(before)
    expect(readFileSync(snapshot, "utf8")).toBe(before)
  })

  it("a log that is absent is still an empty log, so a fresh vault opens", () => {
    expect(readWalTolerant(join(vault, WAL_FILE))).toEqual({ entries: [], truncated: 0 })
    expect(() => new VaultMutationWriter({ root: vault })).not.toThrow()
  })
})

describe("an append does not write through a second name", () => {
  it("an append through a hard link to a file outside is refused, and the outside file is not written", () => {
    const target = join(outside, "target.txt")
    writeFileSync(target, "outside\n")
    const link = join(vault, "log.jsonl")
    linkSync(target, link)

    expect(() => appendLineDurable(link, "inside")).toThrow()
    expect(readFileSync(target, "utf8")).toBe("outside\n")
  })
})

describe("the vault's own folder is not a place recovery or a create may reach", () => {
  it("a temporary in the vault's own folder is not recovered over the policy file", () => {
    const planted = '{"egress":"allow"}\n'
    writeFileSync(join(vault, ".unifia", "policy.json.unifia-tmp"), planted)
    writeFileSync(join(vault, WAL_FILE), `${walLine(1, { locator: ".unifia/policy.json", newHash: sha256(planted) })}\n`)

    recover(vault, WAL_FILE)

    expect(existsSync(join(vault, ".unifia", "policy.json"))).toBe(false)
    expect(existsSync(join(vault, ".unifia", "policy.json.unifia-tmp"))).toBe(true)
  })

  it("a move whose previous locator is in the vault's own folder does not unlink that file", () => {
    const body = "---\nunifia_id: 22222222-2222-4222-8222-222222222222\n---\nbody\n"
    mkdirSync(join(vault, "notes"), { recursive: true })
    writeFileSync(join(vault, "notes", "x.md"), body)
    writeFileSync(join(vault, ".unifia", "policy.json"), body)
    writeFileSync(
      join(vault, WAL_FILE),
      `${walLine(1, {
        kind: "move",
        locator: "notes/x.md",
        previousLocator: ".unifia/policy.json",
        previousHash: sha256(body),
        newHash: sha256(body),
      })}\n`,
    )

    recover(vault, WAL_FILE)

    expect(existsSync(join(vault, ".unifia", "policy.json"))).toBe(true)
  })

  it("a create whose target is in the vault's own folder is refused, and no file is written there", async () => {
    const writer = new VaultMutationWriter({ root: vault })

    await expect(
      writer.apply({
        intent: {
          kind: "create",
          targetLocator: ".unifia/policy.json",
          newContent: { type: "decision", restrictions: OPEN, body: "body" },
          reason: "test",
          source: "test",
        },
        reason: "test",
        source: "test",
      }),
    ).rejects.toThrow()
    expect(existsSync(join(vault, ".unifia", "policy.json"))).toBe(false)
  })
})

describe("the egress control log names no path when it cannot be written or read", () => {
  it("a control log that is a folder fails to flush with a message that names no path", () => {
    mkdirSync(join(vault, ".unifia", "control-log.jsonl"), { recursive: true })
    const audit = new PersistentEgressAudit(vault)
    audit.record(egressEntry())

    let first = ""
    try {
      audit.flush()
    } catch (error) {
      first = (error as Error).message
    }
    expect(first).not.toBe("")
    expect(first).not.toContain(base)

    let second = ""
    try {
      audit.record(egressEntry())
    } catch (error) {
      second = (error as Error).message
    }
    expect(second).not.toBe("")
    expect(second).not.toContain(base)
  })

  it("the control log's entries are not read through a link to a file outside", () => {
    const outsideLog = join(outside, "control-log.jsonl")
    writeFileSync(outsideLog, `${JSON.stringify(egressEntryFields())}\n`)
    symlinkSync(outsideLog, join(vault, ".unifia", "control-log.jsonl"))

    expect(() => new PersistentEgressAudit(vault).entries()).toThrow()
  })
})

function egressEntryFields() {
  return {
    hash: sha256("content"),
    destination: "remote:example",
    decision: "deny",
    reason: "test",
    guardVersion: "1",
    timestamp: new Date().toISOString(),
  }
}

function egressEntry() {
  return egressEntryFields() as Parameters<PersistentEgressAudit["record"]>[0]
}
