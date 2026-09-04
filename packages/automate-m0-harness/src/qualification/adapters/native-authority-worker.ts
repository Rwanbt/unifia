/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Native authority worker (subprocess for FC-14 / FC-25).
 *
 * Spawned by `NativeSqliteCandidate.raceAuthorities(...)` so the
 * Native candidate can participate in a REAL two-OS-process
 * authority race on a shared storeDir. The worker opens the
 * same SQLite file the parent opened, applies the SAME
 * (generation, authority_owner_id) authority contract, and
 * exposes the primitives over a small HTTP loopback
 * (127.0.0.1:0).
 *
 * Endpoints:
 *   GET  /healthz     : readiness probe
 *   POST /claim?runId=X    : attempt authority claim
 *   GET  /inspect?runId=X  : read current authority state
 *   POST /mutate?runId=X   : attempt authoritative mutation
 *   POST /dispatch?runId=X : authorize effect dispatch
 *   POST /takeover?runId=X : qualification-only takeover
 *   POST /shutdown         : graceful shutdown
 *
 * Env:
 *   M0_NATIVE_STORE_DIR : directory containing the SQLite store
 *   M0_NATIVE_OWNER_ID  : process-local authority owner id
 *   M0_NATIVE_LABEL     : human-readable label (A / B) for logs
 */

import { Database } from "bun:sqlite"
import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"

const storeDir = process.env.M0_NATIVE_STORE_DIR
const ownerId = process.env.M0_NATIVE_OWNER_ID
const label = process.env.M0_NATIVE_LABEL ?? "?"
if (!storeDir || !ownerId) {
  console.error("missing M0_NATIVE_STORE_DIR or M0_NATIVE_OWNER_ID")
  process.exit(2)
}
if (!existsSync(storeDir)) mkdirSync(storeDir, { recursive: true })

const dbPath = join(storeDir, "native.sqlite")
const db = new Database(dbPath, { create: true })
db.exec("PRAGMA journal_mode = WAL;")
db.exec("PRAGMA synchronous = FULL;")
db.exec("PRAGMA busy_timeout = 5000;")
db.exec("PRAGMA foreign_keys = ON;")
db.exec(`
  CREATE TABLE IF NOT EXISTS run_authority (
    run_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL DEFAULT 0,
    authority_owner_id TEXT NOT NULL DEFAULT '',
    holder_pid INTEGER NOT NULL DEFAULT 0,
    acquired_at_epoch_ms INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS effect_dispatch_auth (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    effect_key TEXT NOT NULL,
    generation INTEGER NOT NULL,
    authority_owner_id TEXT NOT NULL,
    authorized_at_epoch_ms INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS run_state_mutations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    mutation TEXT NOT NULL,
    generation INTEGER NOT NULL,
    authority_owner_id TEXT NOT NULL,
    mutated_at_epoch_ms INTEGER NOT NULL
  );
`)

const claimAuthority = (runId: string, attemptedGeneration: number) => {
  // bun:sqlite's `db.transaction(...)` defaults to BEGIN DEFERRED
  // which is not safe for cross-process races (both processes can
  // BEGIN, then both INSERT, then both COMMIT). We use raw
  // BEGIN IMMEDIATE so the writer lock is acquired at the start
  // of the transaction; the other process blocks on the SQLite
  // file lock until we COMMIT.
  db.run("BEGIN IMMEDIATE")
  try {
    const row = db.query(
      `SELECT generation, authority_owner_id, holder_pid FROM run_authority WHERE run_id = ?`,
    ).get(runId) as { generation: number; authority_owner_id: string; holder_pid: number } | null
    if (!row) {
      db.run(
        `INSERT INTO run_authority (run_id, generation, authority_owner_id, holder_pid, acquired_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`,
        [runId, 1, ownerId, process.pid, Date.now()],
      )
      db.run("COMMIT")
      return { granted: true, currentGeneration: 1, authorityOwnerId: ownerId, holderPid: process.pid }
    }
    db.run("COMMIT")
    if (row.authority_owner_id === ownerId && row.generation === attemptedGeneration) {
      return { granted: true, currentGeneration: row.generation, authorityOwnerId: row.authority_owner_id, holderPid: row.holder_pid }
    }
    return { granted: false, currentGeneration: row.generation, authorityOwnerId: row.authority_owner_id, holderPid: row.holder_pid }
  } catch (e) {
    db.run("ROLLBACK")
    throw e
  }
}

const inspectAuthority = (runId: string) => {
  const row = db.query(
    `SELECT generation, authority_owner_id, holder_pid FROM run_authority WHERE run_id = ?`,
  ).get(runId) as { generation: number; authority_owner_id: string; holder_pid: number } | null
  if (!row) return { currentGeneration: 0, authorityOwnerId: "", holderPid: 0 }
  return { currentGeneration: row.generation, authorityOwnerId: row.authority_owner_id, holderPid: row.holder_pid }
}

const mutate = (runId: string, token: { attemptedGeneration: number; authorityOwnerId: string }, mutation: string) => {
  return db.transaction(() => {
    const row = db.query(
      `SELECT generation, authority_owner_id FROM run_authority WHERE run_id = ?`,
    ).get(runId) as { generation: number; authority_owner_id: string } | null
    if (!row) return { ok: false, reason: "UNKNOWN_RUN" }
    if (row.generation !== token.attemptedGeneration || row.authority_owner_id !== token.authorityOwnerId) {
      return { ok: false, reason: "STALE_AUTHORITY" }
    }
    db.run(
      `INSERT INTO run_state_mutations (run_id, mutation, generation, authority_owner_id, mutated_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`,
      [runId, mutation, row.generation, row.authority_owner_id, Date.now()],
    )
    return { ok: true }
  })()
}

const dispatch = (runId: string, token: { attemptedGeneration: number; authorityOwnerId: string }, effectKey: string) => {
  return db.transaction(() => {
    const row = db.query(
      `SELECT generation, authority_owner_id FROM run_authority WHERE run_id = ?`,
    ).get(runId) as { generation: number; authority_owner_id: string } | null
    if (!row) return { ok: false, reason: "UNKNOWN_RUN" }
    if (row.generation !== token.attemptedGeneration || row.authority_owner_id !== token.authorityOwnerId) {
      return { ok: false, reason: "STALE_AUTHORITY" }
    }
    db.run(
      `INSERT INTO effect_dispatch_auth (run_id, effect_key, generation, authority_owner_id, authorized_at_epoch_ms) VALUES (?, ?, ?, ?, ?)`,
      [runId, effectKey, row.generation, row.authority_owner_id, Date.now()],
    )
    return { ok: true }
  })()
}

const takeover = (runId: string, expectedCurrentGeneration: number, newOwnerId: string) => {
  return db.transaction(() => {
    const row = db.query(
      `SELECT generation, authority_owner_id FROM run_authority WHERE run_id = ?`,
    ).get(runId) as { generation: number; authority_owner_id: string } | null
    if (!row) return { ok: false, reason: "UNKNOWN_RUN" }
    if (row.generation !== expectedCurrentGeneration) return { ok: false, reason: "GENERATION_MISMATCH", currentGeneration: row.generation, currentOwner: row.authority_owner_id }
    const newGen = row.generation + 1
    db.run(
      `UPDATE run_authority SET generation = ?, authority_owner_id = ?, holder_pid = ?, acquired_at_epoch_ms = ? WHERE run_id = ?`,
      [newGen, newOwnerId, 0, Date.now(), runId],
    )
    return { ok: true, previousGeneration: row.generation, previousOwner: row.authority_owner_id, newGeneration: newGen, newOwner: newOwnerId }
  })()
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })

const srv = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (req: Request) => {
    const url = new URL(req.url)
    if (url.pathname === "/healthz") return new Response("ok", { status: 200 })
    if (url.pathname === "/shutdown" && req.method === "POST") {
      // Graceful: close the DB and exit.
      setTimeout(() => { try { db.close() } catch { /* noop */ }; process.exit(0) }, 50)
      return json({ status: "shutting-down" })
    }
    if (url.pathname === "/claim" && req.method === "POST") {
      const runId = url.searchParams.get("runId") ?? ""
      const body = await req.json() as { attemptedGeneration: number }
      try {
        const r = claimAuthority(runId, body.attemptedGeneration)
        return json(r)
      } catch (e) {
        return json({ error: (e as Error).message }, 500)
      }
    }
    if (url.pathname === "/inspect" && req.method === "GET") {
      const runId = url.searchParams.get("runId") ?? ""
      return json(inspectAuthority(runId))
    }
    if (url.pathname === "/mutate" && req.method === "POST") {
      const runId = url.searchParams.get("runId") ?? ""
      const body = await req.json() as { token: { attemptedGeneration: number; authorityOwnerId: string }; mutation: string }
      const r = mutate(runId, body.token, body.mutation)
      if (!r.ok) return json({ error: r.reason }, 403)
      return json({ status: "mutated" })
    }
    if (url.pathname === "/dispatch" && req.method === "POST") {
      const runId = url.searchParams.get("runId") ?? ""
      const body = await req.json() as { token: { attemptedGeneration: number; authorityOwnerId: string }; effectKey: string }
      const r = dispatch(runId, body.token, body.effectKey)
      if (!r.ok) return json({ error: r.reason }, 403)
      return json({ status: "dispatched" })
    }
    if (url.pathname === "/takeover" && req.method === "POST") {
      const runId = url.searchParams.get("runId") ?? ""
      const body = await req.json() as { newAuthorityOwnerId: string }
      const r = takeover(runId, 1, body.newAuthorityOwnerId)
      if (!r.ok) return json({ error: r.reason }, 403)
      return json(r)
    }
    return new Response("not found", { status: 404 })
  },
})

// Print bind address on stdout for the parent to discover.
console.log(`${srv.hostname}:${srv.port}`)
console.log(`native-authority-worker ready (label=${label} ownerId=${ownerId} pid=${process.pid})`)
