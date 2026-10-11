/* SPDX-License-Identifier: MIT */
/**
 * Cases the second independent review of 409b10caa found. Each one fails on that head and passes once it is fixed.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recover } from "../../../src/knowledge/mutation/durability.js"
import { VaultMutationWriter, WAL_FILE } from "../../../src/knowledge/mutation/writer.js"
import { readContainedByHandleSync } from "../../../src/knowledge/source/vault.js"

const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const
const ID = "00000000-0000-4000-8000-0000000000d1"

let base: string
let outside: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "unifia-review-r4-"))
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

function createIntent(locator: string) {
  return {
    intent: {
      kind: "create",
      targetLocator: locator,
      newContent: { type: "decision", restrictions: OPEN, body: "body" },
      reason: "test",
      source: "test",
    },
    reason: "test",
    source: "test",
  }
}

describe("recovery finishes a temporary for the note its WAL entry names", () => {
  it("a committed temporary in a folder named like the vault's own folder, deeper in the vault, is recovered", () => {
    const content = "---\nunifia_id: 22222222-2222-4222-8222-222222222222\n---\nbody\n"
    mkdirSync(join(vault, "sub", ".unifia"), { recursive: true })
    writeFileSync(join(vault, "sub", ".unifia", "x.md.unifia-tmp"), content)
    writeFileSync(join(vault, WAL_FILE), `${walLine(1, { locator: "sub/.unifia/x.md", newHash: sha256(content) })}\n`)

    const report = recover(vault, WAL_FILE)

    expect(report.completed).toHaveLength(1)
    expect(readFileSync(join(vault, "sub", ".unifia", "x.md"), "utf8")).toBe(content)
  })

  it("the same bytes committed to one note do not complete another note's temporary", () => {
    const content = "the committed bytes"
    mkdirSync(join(vault, "notes"), { recursive: true })
    writeFileSync(join(vault, "notes", "b.md"), "original b")
    writeFileSync(join(vault, "notes", "b.md.unifia-tmp"), content)
    writeFileSync(join(vault, WAL_FILE), `${walLine(1, { locator: "notes/a.md", newHash: sha256(content) })}\n`)

    recover(vault, WAL_FILE)

    expect(readFileSync(join(vault, "notes", "b.md"), "utf8")).toBe("original b")
    expect(existsSync(join(vault, "notes", "b.md.unifia-tmp"))).toBe(false)
  })
})

describe("the reader does not read a note that is a second name of a file outside the vault", () => {
  it("a note linked to a file outside is refused, and none of the outside bytes are returned", () => {
    const outsideFile = join(outside, "target.txt")
    writeFileSync(outsideFile, "outside bytes")
    mkdirSync(join(vault, "notes"), { recursive: true })
    linkSync(outsideFile, join(vault, "notes", "x.md"))

    expect(() => readContainedByHandleSync(join(vault, "notes", "x.md"), "notes/x.md")).toThrow()
  })
})

describe("the vault's own folder is refused under every spelling the platforms fold together", () => {
  it("a create under a folder spelled in capitals is refused, and nothing is written there", async () => {
    const writer = new VaultMutationWriter({ root: vault })

    await expect(writer.apply(createIntent(".UNIFIA/policy.json"))).rejects.toThrow()
    expect(existsSync(join(vault, ".UNIFIA", "policy.json"))).toBe(false)
  })

  it("a create under a folder with a trailing dot is refused too", async () => {
    const writer = new VaultMutationWriter({ root: vault })

    await expect(writer.apply(createIntent("notes/.unifia./x.md"))).rejects.toThrow()
    expect(existsSync(join(vault, "notes", ".unifia.", "x.md"))).toBe(false)
  })
})

describe("a failure to lock the vault names no path", () => {
  it("when the vault's own folder is a file, the write is refused with a message that names no path", async () => {
    rmSync(join(vault, ".unifia"), { recursive: true, force: true })
    writeFileSync(join(vault, ".unifia"), "not a folder")
    const writer = new VaultMutationWriter({ root: vault, recoverOnOpen: false })

    let message = ""
    try {
      await writer.apply(createIntent("notes/y.md"))
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).not.toBe("")
    expect(message).not.toContain(base)
  })
})

describe("a move, a delete or a supersede never takes a note that is a second name of a file outside", () => {
  const LINKED_ID = "018f1f2e-7a3b-7c4d-8e5f-0123456789ab"

  it("a move of a note linked to an outside file is refused, and no outside bytes enter the vault", async () => {
    const otherVault = join(outside, "vault")
    mkdirSync(otherVault)
    await new VaultMutationWriter({ root: otherVault }).apply(createIntent("outside-note.md"))
    const outsideFile = join(otherVault, "outside-note.md")
    const outsideText = readFileSync(outsideFile, "utf8")
    const linkedId = /unifia_id: (\S+)/.exec(outsideText)?.[1] ?? ""
    expect(linkedId).not.toBe("")
    mkdirSync(join(vault, "notes"), { recursive: true })
    linkSync(outsideFile, join(vault, "notes", "x.md"))
    const writer = new VaultMutationWriter({ root: vault })

    await expect(
      writer.apply({
        intent: {
          kind: "move",
          targetId: linkedId,
          targetLocator: "moved/x.md",
          expectedVersionHash: sha256(outsideText),
          reason: "test",
          source: "test",
        },
        reason: "test",
        source: "test",
      }),
    ).rejects.toThrow()
    expect(existsSync(join(vault, "moved", "x.md"))).toBe(false)
    expect(readFileSync(outsideFile, "utf8")).toBe(outsideText)
  })
})

describe("recovery completes a temporary only with the newest committed bytes of its note", () => {
  it("a stale temporary of an earlier version does not replace the newest committed version", () => {
    const older = "older version\n"
    const newest = "newest version\n"
    mkdirSync(join(vault, "notes"), { recursive: true })
    writeFileSync(join(vault, "notes", "a.md"), newest)
    writeFileSync(join(vault, "notes", "a.md.unifia-tmp"), older)
    writeFileSync(
      join(vault, WAL_FILE),
      [
        walLine(1, { locator: "notes/a.md", newHash: sha256(older) }),
        walLine(2, { locator: "notes/a.md", newHash: sha256(newest) }),
      ].join("\n") + "\n",
    )

    recover(vault, WAL_FILE)

    expect(readFileSync(join(vault, "notes", "a.md"), "utf8")).toBe(newest)
    expect(existsSync(join(vault, "notes", "a.md.unifia-tmp"))).toBe(false)
  })

})

describe("the vault's own folder is refused under its 8.3 short name too", () => {
  it("a create under UNIFIA~1 is refused, and nothing is written there", async () => {
    const writer = new VaultMutationWriter({ root: vault })

    await expect(writer.apply(createIntent("UNIFIA~1/policy.md"))).rejects.toThrow()
    expect(existsSync(join(vault, "UNIFIA~1", "policy.md"))).toBe(false)
  })
})

describe("a note with a second name inside the vault does not stop a search for another note", () => {
  it("the synchronous search finds a note although several names of another note are linked in the same folder", async () => {
    const writer = new VaultMutationWriter({ root: vault })
    await writer.apply(createIntent("notes/a.md"))
    await writer.apply(createIntent("notes/b.md"))
    const idOf = (locator: string) => /unifia_id: (\S+)/.exec(readFileSync(join(vault, locator), "utf8"))?.[1] ?? ""
    for (let n = 1; n <= 20; n += 1) linkSync(join(vault, "notes", "a.md"), join(vault, "notes", `decoy-${n}.md`))

    const found = (writer as unknown as { locateSync(id: string): { locator: string } }).locateSync(idOf("notes/b.md"))
    expect(found.locator).toBe("notes/b.md")
  })
})
