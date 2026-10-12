/* SPDX-License-Identifier: MIT */
/**
 * Diagnostics and export of the egress control log (admin conventions).
 *
 * The verifier is read-only and reports what it found, never what it fixed.
 * It has to say when the chain is broken and where, so an owner can tell a
 * removed generation, an edited entry and a missing sequence apart. The export
 * copies every generation byte for byte, so a copy can be checked later
 * without the workspace it came from.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import type { ContextItem, ProviderDestinationPlan } from "@unifia/contracts/knowledge"
import { PersistentEgressAudit, CONTROL_LOG_FILE } from "../../../src/knowledge/policy/control-log.js"
import { egressAuditEntry } from "../../../src/knowledge/policy/audit.js"
import {
  verifyControlLog,
  exportControlLog,
  verifyControlLogExport,
} from "../../../src/knowledge/admin/control-log-audit.js"

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
const HASH = sha256("the body nobody may read")
const REMOTE: ProviderDestinationPlan = { providerId: "anthropic", destinationKind: "remote", defaultRestriction: "allow" }
const SMALL = { rotateAtBytes: 1024, generations: 3 }

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

const trailDir = (root: string) => join(root, ".unifia")
/** The active file's name inside the trail folder; `CONTROL_LOG_FILE` carries the folder too. */
const ACTIVE_BASE = "control-log.jsonl"
/** Oldest first: the archives by number, then the active file. */
const trailNames = (root: string) => {
  const names = readdirSync(trailDir(root)).filter((n) => /^control-log\.jsonl(\.\d+)?$/.test(n))
  const archives = names
    .filter((n) => n !== ACTIVE_BASE)
    .sort((a, b) => Number(a.split(".").at(-1)) - Number(b.split(".").at(-1)))
  return names.includes(ACTIVE_BASE) ? [...archives, ACTIVE_BASE] : archives
}

/** A workspace whose trail has rotated through its generations. */
function seedTrail(root: string, count = 30): void {
  const audit = new PersistentEgressAudit(root, undefined, SMALL)
  for (let i = 0; i < count; i++) {
    audit.record(egressAuditEntry(item(), REMOTE, { decision: "deny", reason: `e${String(i).padStart(3, "0")}` }))
    audit.flush()
  }
}

let root: string
let out: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-ctl-admin-"))
  out = join(mkdtempSync(join(tmpdir(), "unifia-ctl-out-")), "export")
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(join(out, ".."), { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// The verifier's report: sequence range, generations, chain status, size.
// ---------------------------------------------------------------------------

describe("the verifier reports the trail", () => {
  it("reports the sequence range, the number of generations, the chain status and the size", () => {
    seedTrail(root)
    const report = verifyControlLog(root, { generations: SMALL.generations })
    expect(report.ok).toBe(true)
    expect(report.chain).toBe("verified")
    expect(report.generationCount).toBe(SMALL.generations)
    expect(report.lastSeq).toBe(30)
    expect(report.firstSeq).not.toBeNull()
    expect(report.firstSeq ?? 0).toBeGreaterThan(1)
    expect(report.entryCount).toBe((report.lastSeq ?? 0) - (report.firstSeq ?? 0) + 1)
    expect(report.bytes).toBe(trailNames(root).reduce((sum, n) => sum + statSync(join(trailDir(root), n)).size, 0))
    expect(report.head).toMatch(/^[0-9a-f]{64}$/)
    expect(report.findings).toEqual([])
  })

  it("is read-only: no byte changes and no file is created, even on an absent workspace", () => {
    seedTrail(root)
    const before = trailNames(root).map((n) => readFileSync(join(trailDir(root), n), "utf8"))
    verifyControlLog(root, { generations: SMALL.generations })
    expect(trailNames(root).map((n) => readFileSync(join(trailDir(root), n), "utf8"))).toEqual(before)

    const empty = join(root, "never-written")
    const report = verifyControlLog(empty)
    expect(report.chain).toBe("empty")
    expect(report.generationCount).toBe(0)
    expect(existsSync(join(empty, ".unifia"))).toBe(false)
  })

  it("reports a legacy generation as not verifiable before this format", () => {
    mkdirSync(trailDir(root), { recursive: true })
    const legacy = JSON.stringify({
      hash: HASH,
      destination: "provider:anthropic:remote",
      decision: "allow",
      reason: "legacy",
      guardVersion: "v1.1",
      timestamp: "2026-01-01T00:00:00.000Z",
    })
    writeFileSync(join(trailDir(root), `${ACTIVE_BASE}.1`), `${legacy}\n`)
    const report = verifyControlLog(root)
    expect(report.generations[0]?.status).toBe("legacy: not verifiable before this format")
    expect(report.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The verifier finds the first gap or mismatch, and says which kind.
// ---------------------------------------------------------------------------

describe("the verifier detects tampering and gaps", () => {
  it("detects a removed middle generation", () => {
    seedTrail(root)
    rmSync(join(trailDir(root), trailNames(root)[1] ?? ""))
    const report = verifyControlLog(root, { generations: SMALL.generations })
    expect(report.ok).toBe(false)
    expect(report.firstFinding?.kind).toBe("missing_generation")
  })

  it("detects a modified entry as a hash mismatch", () => {
    seedTrail(root)
    const target = join(trailDir(root), trailNames(root)[0] ?? "")
    const text = readFileSync(target, "utf8")
    // Change one reason inside the oldest retained generation. Its bytes change, so the next line's link no longer matches.
    writeFileSync(target, text.replace('"reason":"e', '"reason":"X'))
    const report = verifyControlLog(root, { generations: SMALL.generations })
    expect(report.ok).toBe(false)
    expect(report.findings.map((f) => f.kind)).toContain("hash_mismatch")
  })

  it("detects a sequence gap, and reports it before the hash that follows it", () => {
    seedTrail(root)
    const target = join(trailDir(root), trailNames(root)[0] ?? "")
    const lines = readFileSync(target, "utf8").split("\n")
    // Remove the second entry of the oldest retained generation (line 0 is its header).
    lines.splice(2, 1)
    writeFileSync(target, lines.join("\n"))
    const report = verifyControlLog(root, { generations: SMALL.generations })
    expect(report.ok).toBe(false)
    expect(report.firstFinding?.kind).toBe("sequence_gap")
  })
})

// ---------------------------------------------------------------------------
// Export: every generation, byte for byte, with a manifest that can be checked.
// ---------------------------------------------------------------------------

describe("the export copies every generation and can be checked later", () => {
  it("copies each generation byte for byte and records its hash", () => {
    seedTrail(root)
    const manifest = exportControlLog({ workspaceRoot: root, destination: out })
    expect(manifest.generations.map((g) => g.name)).toEqual(trailNames(root))
    for (const name of trailNames(root)) {
      expect(readFileSync(join(out, name), "utf8")).toBe(readFileSync(join(trailDir(root), name), "utf8"))
    }
    expect(manifest.generations[0]?.sha256).toBe(
      sha256(readFileSync(join(trailDir(root), trailNames(root)[0] ?? ""), "utf8")),
    )
    expect(manifest.verification.ok).toBe(true)
  })

  it("the export verifies on its own, and a changed copy is reported by name", () => {
    seedTrail(root)
    exportControlLog({ workspaceRoot: root, destination: out })
    expect(verifyControlLogExport(out).ok).toBe(true)

    const copy = join(out, trailNames(root)[0] ?? "")
    writeFileSync(copy, `${readFileSync(copy, "utf8")} `)
    const check = verifyControlLogExport(out)
    expect(check.ok).toBe(false)
    expect(check.altered).toContain(trailNames(root)[0])
  })

  it("refuses a destination inside the trail it copies", () => {
    seedTrail(root)
    expect(() => exportControlLog({ workspaceRoot: root, destination: join(trailDir(root), "export") })).toThrow()
  })

  it.skipIf(process.platform === "win32")("the exported files are owner-only", () => {
    seedTrail(root)
    exportControlLog({ workspaceRoot: root, destination: out })
    for (const name of trailNames(root)) {
      expect(statSync(join(out, name)).mode & 0o777).toBe(0o600)
    }
  })
})
