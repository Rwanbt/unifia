/* SPDX-License-Identifier: MIT */
/**
 * Shared fixture for the conflict-resolution tests. A conflict is the state a crash leaves: a committed write whose temporary
 * was never renamed over the note, and then the owner's own edit at the note, so the destination holds neither the pre-write
 * bytes nor the bytes the log expects.
 */

import { afterEach } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TMP_SUFFIX, appendLineDurable, writeFileDurable } from "../../../src/knowledge/mutation/durability.js"
import { WAL_FILE, VaultMutationWriter } from "../../../src/knowledge/mutation/writer.js"

export const ID = "0190d2c0-7b00-7000-8000-000000000001"

/** SHA-256 hex of the bytes, as the writer hashes a version. */
export const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex")

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fresh vault root with its internal folder. */
export function freshVault(): string {
  const base = mkdtempSync(join(tmpdir(), "unifia-conflict-"))
  made.push(base)
  const root = join(base, "vault")
  mkdirSync(join(root, ".unifia"), { recursive: true })
  return root
}

/** A note with valid frontmatter for `id`, and the given body. */
export function note(body: string, id: string = ID): string {
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

/** One WAL line, shaped as the writer appends it. */
export function walLine(seq: number, fields: Record<string, unknown>): string {
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

export interface CrashedUpdate {
  root: string
  /** The note as the log last committed it before the crashed update. */
  before: string
  /** The crashed update's bytes: the temporary holds them, the log records them, and the rename never landed. */
  pending: string
  /** The owner's edit made after the crash; the destination holds these bytes. */
  edit: string
}

/**
 * The state a crash leaves: note `n.md` committed (seq 1), an update committed to the log (seq 2) whose temporary holds the
 * new bytes, the rename never landed, and the owner then edited the note. Recovery on the next open leaves it as a conflict.
 */
export function crashedUpdate(): CrashedUpdate {
  const root = freshVault()
  const before = note("old body")
  writeFileSync(join(root, "n.md"), before)
  appendLineDurable(
    join(root, WAL_FILE),
    walLine(1, { kind: "create", locator: "n.md", previousHash: null, newHash: sha(before) }),
  )
  const pending = note("committed write, rename failed")
  writeFileDurable(join(root, `n.md${TMP_SUFFIX}`), pending)
  appendLineDurable(
    join(root, WAL_FILE),
    walLine(2, { kind: "update", locator: "n.md", previousHash: sha(before), newHash: sha(pending) }),
  )
  const edit = note("USER EDIT after the crash")
  writeFileSync(join(root, "n.md"), edit)
  return { root, before, pending, edit }
}

/** Open the vault as the writer does: the constructor reconciles it, which is where a conflict record is created. */
export function openWriter(root: string): VaultMutationWriter {
  return new VaultMutationWriter({ root })
}

/** The bytes of a file, as Buffer, so that a comparison is byte for byte. */
export function bytesOf(path: string): Buffer {
  return readFileSync(path)
}

/** Every regular file under `root`, except the WAL and the decisions file, as its bytes. */
export function allVaultFiles(root: string): Buffer[] {
  const out: Buffer[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === ".git") continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (!full.endsWith("wal.jsonl") && !full.endsWith("decisions.jsonl")) out.push(readFileSync(full))
    }
  }
  walk(root)
  return out
}

/** A thrown stand-in for a crash: the state at the throw is the state the process left behind. */
export class SimulatedCrash extends Error {
  constructor(readonly step: string) {
    super(`simulated crash after ${step}`)
  }
}

/** Run `fn` and return the refusal it throws, or fail when it does not refuse. */
export function refusalOf(fn: () => unknown): { kind?: string; message: string } {
  try {
    fn()
  } catch (error) {
    const e = error as { kind?: string; message?: string }
    return { kind: e.kind, message: e.message ?? String(error) }
  }
  throw new Error("expected a refusal, but the call returned")
}
