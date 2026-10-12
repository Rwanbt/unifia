/* SPDX-License-Identifier: MIT */
/**
 * Generations of the egress control log: bounded rotation, crash recovery,
 * surfaced failures, and reads that never go silent across a gap.
 *
 * The owner's repro: a second rotation replaced the first generation, so after
 * two rotations only the last batch survived; the reader opened only the active
 * file; and a failed rename was swallowed while the log grew past its limit.
 * Each test below pins one of the properties that repro broke. The limits are
 * small here (`rotateAtBytes`, `generations`) so the cycles run in milliseconds;
 * the production constants are checked at the end of this file.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import type { ContextItem, ProviderDestinationPlan } from "@unifia/contracts/knowledge"
import {
  PersistentEgressAudit,
  CONTROL_LOG_FILE,
  CONTROL_LOG_GENERATIONS,
  FLUSH_AT_ENTRIES,
  ROTATE_AT_BYTES,
  type RotationStep,
} from "../../../src/knowledge/policy/control-log.js"
import { egressAuditEntry, type EgressAuditEntry } from "../../../src/knowledge/policy/audit.js"
import { DomainBus } from "../../../src/knowledge/events/bus.js"

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
const HASH = sha256("the body nobody may read")

const REMOTE: ProviderDestinationPlan = {
  providerId: "anthropic",
  destinationKind: "remote",
  defaultRestriction: "allow",
}

function item(): ContextItem {
  return {
    ref: { id: "0190d2c0-7b00-7000-8000-000000000001", locator: "secret.md" },
    source: "personal",
    type: "decision",
    trust: "verified",
    authority: "user",
    restriction: "deny",
    relevance: 1,
    tokenCost: 0,
    contentHash: HASH,
    snippet: "the body nobody may read",
    reason: "test",
  } as ContextItem
}

const tag = (i: number) => `e${String(i).padStart(3, "0")}`

/** The i-th decision. Its reason carries the index, so a test can tell which events survived. */
function entryFor(i: number): EgressAuditEntry {
  return egressAuditEntry(item(), REMOTE, { decision: "deny", reason: tag(i) })
}

/** Small limits: a rotation every few entries, three generations kept. */
const SMALL = { rotateAtBytes: 1024, generations: 3 }

/** The active file's name inside the trail folder (`CONTROL_LOG_FILE` carries the folder too). */
const ACTIVE_BASE = "control-log.jsonl"
const logPath = (root: string) => join(root, CONTROL_LOG_FILE)
const archivePath = (root: string, k: number) => `${logPath(root)}.${k}`
const tempPath = (root: string) => `${logPath(root)}.rotating`

/**
 * Every trail file in the folder, oldest first: the archives by their number,
 * then the active file last. Numeric, because `.10` sorts before `.9` as text.
 */
function trailFiles(root: string): string[] {
  const names = readdirSync(join(root, ".unifia")).filter((name) => /^control-log\.jsonl(\.\d+)?$/.test(name))
  const archives = names
    .filter((name) => name !== ACTIVE_BASE)
    .sort((a, b) => Number(a.split(".").at(-1)) - Number(b.split(".").at(-1)))
  return names.includes(ACTIVE_BASE) ? [...archives, ACTIVE_BASE] : archives
}

function reasonsOf(audit: PersistentEgressAudit): string[] {
  return audit.entries().map((e) => e.reason)
}

/** Write `count` decisions, one flush each, so every flush is a chance to rotate. */
function writeEach(audit: PersistentEgressAudit, from: number, count: number): void {
  for (let i = from; i < from + count; i++) {
    audit.record(entryFor(i))
    audit.flush()
  }
}

/** The message of whatever `run` throws, or "" when it returns. */
function messageOf(run: () => unknown): string {
  try {
    run()
    return ""
  } catch (error) {
    return (error as Error).message
  }
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-gen-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

// ---------------------------------------------------------------------------
// Bounded rotation: exactly N generations, the newest events, no older ones.
// ---------------------------------------------------------------------------

describe("bounded generations: rotation keeps N and the newest events", () => {
  it("keeps exactly N generation files over many rotations", () => {
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, 60)
    expect(trailFiles(root)).toHaveLength(SMALL.generations)
  })

  it("keeps the newest event, and reads the retained events in order with no gap", () => {
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, 60)
    const reasons = reasonsOf(new PersistentEgressAudit(root, undefined, SMALL))
    expect(reasons.at(-1)).toBe(tag(59))
    // Contiguous across generation boundaries: a skipped number would be a lost event.
    for (let i = 1; i < reasons.length; i++) {
      expect(Number(reasons[i]?.slice(1))).toBe(Number(reasons[i - 1]?.slice(1)) + 1)
    }
  })

  it("returns no event older than the retention", () => {
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, 60)
    const reasons = reasonsOf(new PersistentEgressAudit(root, undefined, SMALL))
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons).not.toContain(tag(0))
    expect(reasons.length).toBeLessThan(60)
  })

  it("bounds the bytes on disk to N generations of the limit, plus one batch each", () => {
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, 60)
    const total = trailFiles(root).reduce((sum, name) => sum + statSync(join(root, ".unifia", name)).size, 0)
    // A batch of one line is far below 1 KiB; the bound is the limit plus that slack per generation.
    expect(total).toBeLessThanOrEqual(SMALL.generations * (SMALL.rotateAtBytes + 1024))
  })

  it("moves events between generations rather than copying them: no event is held twice", () => {
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, 60)
    const reasons = reasonsOf(new PersistentEgressAudit(root, undefined, SMALL))
    expect(new Set(reasons).size).toBe(reasons.length)
  })
})

// ---------------------------------------------------------------------------
// Crash-safe rotation: a crash at each step leaves a readable, consistent trail.
// ---------------------------------------------------------------------------

const STEPS: RotationStep[] = ["temp-written", "sealed", "committed", "pruned"]

describe("crash-safe rotation: a crash at each step leaves a consistent trail", () => {
  for (const step of STEPS) {
    it(`a crash after "${step}" keeps the newest durable event readable, and the next open completes the set`, () => {
      // A trail that has already rotated, so the injected crash lands in a rotation and not in the first generation.
      const seeded = 10
      writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, seeded)
      let crashed = false
      const crashing = new PersistentEgressAudit(root, undefined, {
        ...SMALL,
        onRotationStep: (s) => {
          if (s === step && !crashed) {
            crashed = true
            throw new Error("injected crash")
          }
        },
      })

      // Only events whose flush returned are durable; the one that crashed is not.
      const durable: string[] = Array.from({ length: seeded }, (_, i) => tag(i))
      for (let i = seeded; i < 60 && !crashed; i++) {
        crashing.record(entryFor(i))
        try {
          crashing.flush()
          durable.push(tag(i))
        } catch {
          // The injected crash, or the failure that follows it.
        }
      }
      expect(crashed).toBe(true)

      const next = new PersistentEgressAudit(root, undefined, SMALL)
      expect(reasonsOf(next).at(-1)).toBe(durable.at(-1))
      expect(next.verify().ok).toBe(true)

      // The next flush completes the interrupted rotation and leaves exactly N generations.
      writeEach(next, 900, 4)
      expect(trailFiles(root)).toHaveLength(SMALL.generations)
      expect(reasonsOf(new PersistentEgressAudit(root, undefined, SMALL)).at(-1)).toBe(tag(903))
      expect(new PersistentEgressAudit(root, undefined, SMALL).verify().ok).toBe(true)
    })
  }

  it("a temporary generation left by a crash before the seal is not read as events, and is removed", () => {
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, 10)
    const header = `{"generation":{"index":99,"firstSeq":1,"continues":"${"0".repeat(64)}"}}\n`
    writeFileSync(tempPath(root), header)
    expect(reasonsOf(new PersistentEgressAudit(root, undefined, SMALL)).at(-1)).toBe(tag(9))
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 100, 1)
    expect(existsSync(tempPath(root))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// A failed rename or write is surfaced to the caller, and never claimed.
// ---------------------------------------------------------------------------

describe("failures are surfaced, and the record that failed is not claimed", () => {
  it("a rotation that cannot seal the active generation fails the record that triggered it", () => {
    // A folder where the first archive belongs: the seal refuses to overwrite and must say so.
    mkdirSync(archivePath(root, 1), { recursive: true })
    const bus = new DomainBus()
    const seen: unknown[] = []
    bus.on("egress.decision", (e) => seen.push(e.payload))
    const audit = new PersistentEgressAudit(root, bus, SMALL)

    let accepted = 0
    let refused: unknown = null
    for (let i = 0; i < 300 && refused === null; i++) {
      try {
        audit.record(entryFor(i))
        accepted += 1
      } catch (error) {
        refused = error
      }
    }
    expect(refused).toBeInstanceOf(Error)
    // The refused record reached neither the bus nor the pending batch.
    expect(seen).toHaveLength(accepted)
    expect(audit.pendingCount).toBe(FLUSH_AT_ENTRIES - 1)
    expect(audit.broken).not.toBeNull()
    expect((refused as Error).message).not.toContain(root)
  })

  it("a write that fails is surfaced by the record that triggered it, and no bus event is emitted for it", () => {
    // A folder where the active log belongs: the append cannot succeed.
    mkdirSync(logPath(root), { recursive: true })
    const bus = new DomainBus()
    const seen: unknown[] = []
    bus.on("egress.decision", (e) => seen.push(e.payload))
    const audit = new PersistentEgressAudit(root, bus, SMALL)

    let accepted = 0
    let refused: unknown = null
    for (let i = 0; i < 300 && refused === null; i++) {
      try {
        audit.record(entryFor(i))
        accepted += 1
      } catch (error) {
        refused = error
      }
    }
    expect(refused).toBeInstanceOf(Error)
    expect(seen).toHaveLength(accepted)
    expect(audit.pendingCount).toBe(accepted)
    expect((refused as Error).message).not.toContain(root)
  })

  it("a failure names no path", () => {
    mkdirSync(logPath(root), { recursive: true })
    const audit = new PersistentEgressAudit(root, undefined, SMALL)
    audit.record(entryFor(0))
    const message = messageOf(() => audit.flush())
    expect(message).not.toBe("")
    expect(message).not.toContain(root)
  })

  it("a write lock held by another live writer is a transient refusal: the decisions stay pending, and the sink is not broken", () => {
    mkdirSync(join(root, ".unifia"), { recursive: true })
    const lock = join(root, ".unifia", "control-log.lock")
    writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    const audit = new PersistentEgressAudit(root, undefined, SMALL)
    audit.record(entryFor(0))
    expect(() => audit.flush()).toThrow(/another writer/)
    expect(audit.pendingCount).toBe(1)
    expect(audit.broken).toBeNull()
    rmSync(lock)
    audit.flush()
    expect(audit.pendingCount).toBe(0)
    expect(reasonsOf(new PersistentEgressAudit(root, undefined, SMALL))).toEqual([tag(0)])
  })
})

// ---------------------------------------------------------------------------
// Two writers, one chain.
// ---------------------------------------------------------------------------

describe("two writers on one trail keep one chain", () => {
  it("interleaved sinks on the same folder produce a chain that verifies", () => {
    const a = new PersistentEgressAudit(root, undefined, SMALL)
    const b = new PersistentEgressAudit(root, undefined, SMALL)
    for (let i = 0; i < 30; i++) {
      const writer = i % 2 === 0 ? a : b
      writer.record(entryFor(i))
      writer.flush()
    }
    const reader = new PersistentEgressAudit(root, undefined, SMALL)
    expect(reader.verify().ok).toBe(true)
    expect(reasonsOf(reader).at(-1)).toBe(tag(29))
  })
})

// ---------------------------------------------------------------------------
// Reads: a gap is reported, and every reader sees every generation.
// ---------------------------------------------------------------------------

describe("consistent reads across generations", () => {
  it("a missing middle generation is a reported error for every reader, not silence", () => {
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, 40)
    const names = trailFiles(root)
    expect(names).toHaveLength(SMALL.generations)
    // Remove the middle one: the set has a hole the chain cannot bridge.
    rmSync(join(root, ".unifia", names[1] ?? ""))

    const reader = new PersistentEgressAudit(root, undefined, SMALL)
    for (const read of [() => reader.entries(), () => reader.tally(), () => reader.destinationsFor(HASH)]) {
      const message = messageOf(read)
      expect(message).toMatch(/incomplete/)
      expect(message).not.toContain(root)
    }
  })

  it("tally and destinationsFor count decisions held in every retained generation", () => {
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, 20)
    const reader = new PersistentEgressAudit(root, undefined, SMALL)
    const all = reader.entries()
    expect(trailFiles(root).length).toBeGreaterThan(1)
    expect(reader.tally()).toEqual({ allow: 0, deny: all.length })
    expect(reader.destinationsFor(HASH)).toHaveLength(all.length)
  })
})

// ---------------------------------------------------------------------------
// Restricted access: generation files are owner-only where the platform allows it.
// ---------------------------------------------------------------------------

describe("restricted access", () => {
  it.skipIf(process.platform === "win32")("every generation file is created owner-only (0600)", () => {
    writeEach(new PersistentEgressAudit(root, undefined, SMALL), 0, 30)
    const names = trailFiles(root)
    expect(names.length).toBeGreaterThan(1)
    for (const name of names) {
      expect(statSync(join(root, ".unifia", name)).mode & 0o777).toBe(0o600)
    }
  })
})

// ---------------------------------------------------------------------------
// Migration: the single previous generation of the old format is adopted.
// ---------------------------------------------------------------------------

describe("migration from the single-generation format", () => {
  const legacyLine = (reason: string) =>
    JSON.stringify({
      hash: HASH,
      destination: "provider:anthropic:remote",
      decision: "deny",
      reason,
      guardVersion: "v1.1",
      timestamp: "2026-01-01T00:00:00.000Z",
    })

  it("adopts the legacy .1 as the oldest generation and does not delete it", () => {
    mkdirSync(join(root, ".unifia"), { recursive: true })
    const previous = `${legacyLine("legacy0")}\n${legacyLine("legacy1")}\n`
    writeFileSync(archivePath(root, 1), previous)
    writeFileSync(logPath(root), `${legacyLine("legacy2")}\n`)

    const audit = new PersistentEgressAudit(root, undefined, SMALL)
    audit.record(entryFor(7))
    audit.flush()

    expect(readFileSync(archivePath(root, 1), "utf8")).toBe(previous)
    expect(reasonsOf(new PersistentEgressAudit(root, undefined, SMALL))).toEqual([
      "legacy0",
      "legacy1",
      "legacy2",
      tag(7),
    ])
    expect(new PersistentEgressAudit(root, undefined, SMALL).verify().ok).toBe(true)
  })

  it.skipIf(process.platform === "win32")("the adopted legacy generation is tightened to owner-only", () => {
    mkdirSync(join(root, ".unifia"), { recursive: true })
    writeFileSync(archivePath(root, 1), `${legacyLine("legacy0")}\n`)
    const audit = new PersistentEgressAudit(root, undefined, SMALL)
    audit.record(entryFor(1))
    audit.flush()
    expect(statSync(archivePath(root, 1)).mode & 0o777).toBe(0o600)
  })
})

// ---------------------------------------------------------------------------
// The production limits are the documented ones.
// ---------------------------------------------------------------------------

describe("the production limits", () => {
  it("keeps eight mebibytes per generation and six generations", () => {
    expect(ROTATE_AT_BYTES).toBe(8 * 1024 * 1024)
    expect(CONTROL_LOG_GENERATIONS).toBe(6)
  })
})
