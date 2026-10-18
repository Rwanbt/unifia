/* SPDX-License-Identifier: MIT */
/**
 * #480 — opening a vault must not reconcile a live writer's in-flight commit.
 *
 * Reconciliation discards any temporary file that has no WAL record, on the
 * assumption that the write never happened. A writer that is mid-commit has
 * exactly that shape: its temporary exists and its WAL line is not yet
 * appended. When another writer opens the vault in that window, the open used
 * to discard the live temporary, and the owning commit then failed with ENOENT
 * on rename. Reconciliation must run only while no writer holds the lock.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { VaultMutationWriter, LOCK_FILE } from "../../../src/knowledge/mutation/writer.js"
import { TMP_SUFFIX } from "../../../src/knowledge/mutation/durability.js"

describe("#480 — opening a vault while another writer is mid-commit", () => {
  let root: string
  let lockPath: string
  let inFlight: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-open-lock-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
    lockPath = join(root, LOCK_FILE)
    inFlight = join(root, `n.md${TMP_SUFFIX}`)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("leaves another live writer's temporary alone while the write lock is held", () => {
    // Another writer: lock held by a live PID (this process), temporary written, no WAL line yet.
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    writeFileSync(inFlight, "in-flight content")

    new VaultMutationWriter({ root })

    expect(existsSync(inFlight)).toBe(true)
  })

  it("still reconciles an orphaned temporary once the lock is free", () => {
    writeFileSync(inFlight, "orphan")

    const w = new VaultMutationWriter({ root })

    expect(existsSync(inFlight)).toBe(false)
    expect(w.recovery().discarded.length).toBeGreaterThanOrEqual(1)
    expect(existsSync(lockPath)).toBe(false)
  })

  it("reconciles once the other writer releases the lock", () => {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    writeFileSync(inFlight, "in-flight content")
    new VaultMutationWriter({ root })
    expect(existsSync(inFlight)).toBe(true)

    unlinkSync(lockPath)
    new VaultMutationWriter({ root })

    expect(existsSync(inFlight)).toBe(false)
  })
})
