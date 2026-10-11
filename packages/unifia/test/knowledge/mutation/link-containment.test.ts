/* SPDX-License-Identifier: MIT */
/**
 * The writer never follows a link out of the vault.
 *
 * Each case plants a link where the writer would create, recover or read a file, then checks that nothing outside the
 * vault changed. Recovery runs when a writer opens, so its case opens one over the planted link.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openMemory, resetMemoryCache } from "../../../src/knowledge/app/memory.js"
import { VaultMutationWriter } from "../../../src/knowledge/mutation/writer.js"
import { PolicyError, readPolicy } from "../../../src/knowledge/policy/store.js"

const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const

let base: string
let worktree: string
let outside: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "unifia-links-"))
  worktree = join(base, "project")
  outside = join(base, "outside")
  mkdirSync(worktree)
  mkdirSync(outside)
  vault = join(worktree, ".unifia", "memory")
  resetMemoryCache()
})

afterEach(() => {
  resetMemoryCache()
  rmSync(base, { recursive: true, force: true })
})

/** The owner's writable composition of the vault, created on first use. */
function openOwner() {
  const composed = openMemory({
    worktree,
    providerId: "unifia-ui",
    destinationKind: "local",
    audience: "owner",
    writable: true,
    create: true,
  })
  if (composed === undefined) throw new Error("the vault should open")
  return composed
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

describe("a temporary file of a commit is created exclusively", () => {
  it("a temporary planted as a dangling link is not written through: the create is refused and the target is not made", async () => {
    const composed = openOwner()
    mkdirSync(join(vault, "notes"))
    const target = join(outside, "target.md")
    const planted = join(vault, "notes", "new.md.unifia-tmp")
    symlinkSync(target, planted)

    await expect(
      composed.service.propose({
        intent: {
          kind: "create",
          targetLocator: "notes/new.md",
          newContent: { type: "decision", restrictions: OPEN, body: "body" },
          reason: "links",
          source: "test",
        } as never,
        reason: "links",
        source: "test",
      }),
    ).rejects.toThrow()
    expect(existsSync(target)).toBe(false)
    expect(lstatSync(planted).isSymbolicLink()).toBe(true)
  })
})

describe("recovery never reads, replaces or deletes through a link", () => {
  it("a temporary file reached through a link out of the vault is not deleted when a writer opens", () => {
    openOwner()
    const planted = join(outside, "x.md.unifia-tmp")
    writeFileSync(planted, "kept")
    symlinkSync(outside, join(vault, "linked"))

    new VaultMutationWriter({ root: vault })

    expect(readFileSync(planted, "utf8")).toBe("kept")
  })
})

describe("a note is located by its real place", () => {
  it("a note reached through a link out of the vault is not found by id, read, or replaced", async () => {
    const composed = openOwner()
    mkdirSync(join(vault, "notes"))
    await composed.service.propose({
      intent: {
        kind: "create",
        targetLocator: "notes/real.md",
        newContent: { type: "decision", restrictions: OPEN, body: "outside body" },
        reason: "links",
        source: "test",
      } as never,
      reason: "links",
      source: "test",
    })
    const inside = join(vault, "notes", "real.md")
    const raw = readFileSync(inside, "utf8")
    const id = /unifia_id:\s*(\S+)/.exec(raw)?.[1]
    if (id === undefined) throw new Error("the created note should carry an id")

    const moved = join(outside, "evil.md")
    renameSync(inside, moved)
    symlinkSync(moved, inside)

    await expect(
      composed.service.propose({
        intent: {
          kind: "update",
          targetId: id,
          expectedVersionHash: sha256(raw),
          newContent: { type: "decision", restrictions: OPEN, body: "changed" },
          reason: "links",
          source: "test",
        } as never,
        reason: "links",
        source: "test",
      }),
    ).rejects.toThrow()
    expect(lstatSync(inside).isSymbolicLink()).toBe(true)
    expect(readFileSync(moved, "utf8")).toBe(raw)
  })
})

describe("a supersede does not walk into a folder that links outside the vault", () => {
  it("both notes of a supersede behind such a folder are not found, and neither is changed", async () => {
    const composed = openOwner()
    mkdirSync(join(vault, "notes"))
    for (const name of ["old", "new"]) {
      await composed.service.propose({
        intent: {
          kind: "create",
          targetLocator: `notes/${name}.md`,
          newContent: { type: "decision", restrictions: OPEN, body: `${name} body` },
          reason: "links",
          source: "test",
        } as never,
        reason: "links",
        source: "test",
      })
    }
    const idOf = (path: string): { id: string; raw: string } => {
      const raw = readFileSync(path, "utf8")
      const id = /unifia_id:\s*(\S+)/.exec(raw)?.[1]
      if (id === undefined) throw new Error("the created note should carry an id")
      return { id, raw }
    }
    const old = idOf(join(vault, "notes", "old.md"))
    const successor = idOf(join(vault, "notes", "new.md"))

    const moved = join(outside, "notes")
    renameSync(join(vault, "notes"), moved)
    symlinkSync(moved, join(vault, "notes"))

    await expect(
      new VaultMutationWriter({ root: vault }).apply({
        intent: {
          kind: "supersede",
          targetId: old.id,
          successorId: successor.id,
          expectedVersionHash: sha256(old.raw),
          reason: "links",
          source: "test",
        },
        reason: "links",
        source: "test",
      }),
    ).rejects.toThrow()
    expect(readFileSync(join(moved, "old.md"), "utf8")).toBe(old.raw)
    expect(readFileSync(join(moved, "new.md"), "utf8")).toBe(successor.raw)
  })
})

describe("a restore takes only an id the writer gave", () => {
  it("an id that climbs out of the trash is refused, and no file outside it is read into the vault", async () => {
    openOwner()
    const victim = join(base, "outside", "victim.md")
    writeFileSync(victim, "---\nunifia_id: 22222222-2222-4222-8222-222222222222\n---\nprivate\n")
    writeFileSync(`${victim}.origin.json`, JSON.stringify({ locator: "notes/stolen.md" }))

    // From the trash folder, five levels up is the base folder that holds `outside`.
    const climbing = "../../../../../outside/victim"
    await expect(new VaultMutationWriter({ root: vault }).restoreDeleted(climbing)).rejects.toThrow()
    expect(existsSync(join(vault, "notes", "stolen.md"))).toBe(false)
    expect(existsSync(victim)).toBe(true)
  })
})

describe("the policy is not read through a link, and its refusal names no path", () => {
  it("a policy file that is a link is refused unread, and the message names neither the link nor its target", () => {
    openOwner()
    const policy = join(vault, ".unifia", "policy.json")
    const target = join(outside, "policy.json")
    writeFileSync(target, "{}")
    rmSync(policy)
    symlinkSync(target, policy)

    let caught: unknown
    try {
      readPolicy(vault)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(PolicyError)
    const message = (caught as Error).message
    expect(message).not.toContain(vault)
    expect(message).not.toContain(outside)
  })
})
