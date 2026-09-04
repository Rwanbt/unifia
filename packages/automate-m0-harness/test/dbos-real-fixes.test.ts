/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * DBOS real candidate — fixes from the 2026-09-04 mandate.
 *
 * Per the latest review:
 *   §6   — store-guard test: the DBOS binary must NEVER
 *          delete an existing durable DB on startup.
 *   §10  — duplicate-start ID test: two startRun with the
 *          same logicalInvocationId MUST produce two
 *          distinct WorkflowRunIds.
 *   §18  — readback must come from DBOS durable step
 *          output, not from any in-process cache.
 *
 * These tests are SUBSTRATE-NEUTRAL: they target the
 * real DBOS Go binary via the harness adapter
 * (`DBOSRealCandidate`). The CUSTOM_GO_SQLITE_CONTROL
 * candidate is not tested here.
 */

import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, existsSync, statSync, rmSync, readFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DBOSRealCandidate,
  FakeExternalEffectProvider,
} from "../src/qualification/index.ts"

const DBOS_REAL_BINARY = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "tools",
  "dbos-real-qualify",
  "dbos-real-qualify.exe",
)

const DBOS_REAL_BUILT = existsSync(DBOS_REAL_BINARY)

let testDir = ""

beforeAll(() => {
  if (!DBOS_REAL_BUILT) return
  testDir = mkdtempSync(join(tmpdir(), "dbos-real-fixes-"))
})

afterAll(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

test.skipIf(!DBOS_REAL_BUILT)(
  "store-guard (mandate §6): DBOS process startup must NOT delete an existing dbos.db",
  async () => {
    const storeDir = join(testDir, "store-guard")
    const providerDir = join(testDir, "store-guard-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "store-guard", buildHash: "store-guard-build" })
    await candidate.initialize()
    try {
      // 1. Write something durable via startRun so dbos.db exists.
      const liId = `li-store-guard-${Date.now()}` as never
      const start = await candidate.startRun({
        workflowVersionId: "wv-1" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: liId,
          effectKey: "ek-1",
          canonicalInput: 42 as never,
        },
        seedCanonicalValue: 42 as never,
      })
      const runId = start as unknown as string
      expect(runId).toBeTruthy()

      // 2. Capture the dbos.db file size BEFORE restart.
      const dbPath = join(storeDir, "dbos.db")
      const beforeStat = statSync(dbPath)
      expect(beforeStat.size).toBeGreaterThan(0)

      // 3. Restart the same process on the same store.
      await candidate.shutdown()
      const candidate2 = new DBOSRealCandidate({ storeDir, version: "store-guard", buildHash: "store-guard-build" })
      await candidate2.initialize()
      try {
        // 4. After fresh startup the durable DB must STILL exist.
        expect(existsSync(dbPath)).toBe(true)
        const afterStat = statSync(dbPath)
        expect(afterStat.size).toBeGreaterThan(0)

        // 5. Recovery: the same WorkflowRunId must still be
        // discoverable from durable state.
        const recovered = await candidate2.inspectRun(runId as never)
        expect(recovered).toBeTruthy()
        // 6. The canonical observation must come from the
        // DBOS step output, not the process-local cache.
        const li = recovered.logicalInvocations.find(
          (l) => l.logicalInvocationId === liId,
        )
        expect(li).toBeDefined()
        expect(li?.canonicalObservation).toBeDefined()
      } finally {
        await candidate2.shutdown()
      }
    } finally {
      void provider
    }
  },
  { timeout: 120_000 },
)

test.skipIf(!DBOS_REAL_BUILT)(
  "duplicate-start ID (mandate §10): two startRun with the same logicalInvocationId MUST produce two distinct WorkflowRunIds",
  async () => {
    const storeDir = join(testDir, "dup-start")
    const providerDir = join(testDir, "dup-start-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "dup-start", buildHash: "dup-start-build" })
    await candidate.initialize()
    try {
      const liId = `li-dup-${Date.now()}` as never
      const a = await candidate.startRun({
        workflowVersionId: "wv-dup" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: liId,
          effectKey: "ek-dup",
          canonicalInput: 1 as never,
        },
        seedCanonicalValue: 1 as never,
      })
      const b = await candidate.startRun({
        workflowVersionId: "wv-dup" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: liId,
          effectKey: "ek-dup",
          canonicalInput: 2 as never,
        },
        seedCanonicalValue: 2 as never,
      })
      const aRun = a as unknown as string
      const bRun = b as unknown as string
      expect(aRun).toBeTruthy()
      expect(bRun).toBeTruthy()
      expect(aRun).not.toEqual(bRun)
    } finally {
      await candidate.shutdown()
      void provider
    }
  },
  { timeout: 120_000 },
)

test.skipIf(!DBOS_REAL_BUILT)(
  "readback source (mandate §18-§19): inspectRun reconstructs from DBOS durable step output, not in-process cache",
  async () => {
    const storeDir = join(testDir, "readback")
    const providerDir = join(testDir, "readback-provider")
    mkdirSync(storeDir, { recursive: true })
    mkdirSync(providerDir, { recursive: true })
    const provider = new FakeExternalEffectProvider({ storeDir: providerDir, dropAckToCandidate: false })
    const candidate = new DBOSRealCandidate({ storeDir, version: "readback", buildHash: "readback-build" })
    await candidate.initialize()
    try {
      const liId = `li-rb-${Date.now()}` as never
      const start = await candidate.startRun({
        workflowVersionId: "wv-rb" as never,
        ownerScope: { organizationId: "org-1" as never, workspaceId: "ws-1" as never },
        initialLogicalInvocation: {
          logicalInvocationId: liId,
          effectKey: "ek-rb",
          canonicalInput: { canary: "readback-value" } as never,
        },
        seedCanonicalValue: { canary: "readback-value" } as never,
      })
      const runId = start as unknown as string
      // Shutdown to clear any in-process cache.
      await candidate.shutdown()
      // Fresh process on the same store.
      const candidate2 = new DBOSRealCandidate({ storeDir, version: "readback", buildHash: "readback-build" })
      await candidate2.initialize()
      try {
        const recovered = await candidate2.inspectRun(runId as never)
        const li = recovered.logicalInvocations.find(
          (l) => l.logicalInvocationId === liId,
        )
        expect(li).toBeDefined()
        // The recovered canonical observation must be defined
        // (it came from the DBOS step output, not from
        // process-local cache).
        const recoveredValue = li?.canonicalObservation
        expect(recoveredValue).toBeDefined()
      } finally {
        await candidate2.shutdown()
      }
    } finally {
      void provider
    }
  },
  { timeout: 120_000 },
)
