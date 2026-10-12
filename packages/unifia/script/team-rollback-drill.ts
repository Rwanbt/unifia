// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

// Rollback drill for the team store. It runs on copies only; the live team.db is never opened.
//
// Usage: bun run script/team-rollback-drill.ts <legacy-team-store-ts> <working-dir>
//
//   <legacy-team-store-ts>  path to the team-store.ts of the version 1.0.0 source, for
//                           example a checkout of an older commit. The drill imports it and
//                           runs its real TeamStore.open. This executes the 1.0.0 source under
//                           Bun; it is not the packaged 1.0.0 executable.
//   <working-dir>           an empty directory the drill may write into.
//
// It checks three things and exits non-zero if any of them differs:
//   1. the current code upgrades a 1.0.0 store and keeps its rows;
//   2. the 1.0.0 source refuses the upgraded store at open (the incompatibility is intended);
//   3. the backup taken before the upgrade opens with the 1.0.0 source and keeps its rows,
//      which is the rollback path.
//
// Rolling back from a backup loses every run written after the upgrade. The drill prints
// the run ids that exist in the upgraded store and not in the backup, so the loss is visible.

import { Database } from "bun:sqlite"
import { copyFile, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { TeamStore } from "../src/team/team-store"

const BASE_MIGRATION = resolve(import.meta.dir, "../migration/20260726193000_team_store/migration.sql")
const STORE_FILE = "team.db"

function fail(message: string): never {
  console.error("DRILL FAILED: " + message)
  process.exit(1)
}

function runIds(path: string): string[] {
  const db = new Database(path, { readonly: true })
  try {
    return (db.query("SELECT run_id FROM team_runs ORDER BY run_id").all() as { run_id: string }[]).map((row) => row.run_id)
  } finally {
    db.close()
  }
}

async function legacyOpen(legacyStore: string, path: string): Promise<string | null> {
  const legacy = (await import(legacyStore)) as { TeamStore: { open(path: string): { close(): void } } }
  try {
    legacy.TeamStore.open(path).close()
    return null
  } catch (error) {
    return (error as Error).message.split("\n")[0] ?? "unknown error"
  }
}

const [legacyArg, workingArg] = process.argv.slice(2)
if (!legacyArg || !workingArg) fail("usage: team-rollback-drill.ts <legacy-team-store-ts> <working-dir>")

const legacyStore = resolve(legacyArg)
const workDir = resolve(workingArg)
await mkdir(workDir, { recursive: true })
const path = join(workDir, STORE_FILE)
const backup = join(workDir, `${STORE_FILE}.bak-1.0.0`)

const seed = new Database(path, { create: true })
seed.exec(await Bun.file(BASE_MIGRATION).text())
seed.query(
  "INSERT INTO team_runs(run_id, schema_version, plan_id, status, created_at, updated_at) VALUES ('run-before-upgrade', '1.0.0', 'plan', 'completed', 'x', 'x')",
).run()
seed.close()

TeamStore.open(path).close()
const upgradeStore = TeamStore.open(path)
await upgradeStore.createRun({ runId: "run-after-upgrade", planId: "plan-after", projectId: "project-drill" })
upgradeStore.close()
const upgradedRuns = runIds(path)
if (!upgradedRuns.includes("run-before-upgrade")) fail("the upgrade lost a row that existed before it")
console.log("1. upgrade ok, runs: " + upgradedRuns.join(", "))

const refusal = await legacyOpen(legacyStore, path)
if (refusal === null) fail("the 1.0.0 source opened the upgraded store; the incompatibility is not there")
console.log("2. 1.0.0 source refused the upgraded store: " + refusal)

// The backup is written by the upgrade itself, next to the store.
await copyFile(backup, join(workDir, "restored.db"))
const restored = join(workDir, "restored.db")
const opened = await legacyOpen(legacyStore, restored)
if (opened !== null) fail("the 1.0.0 source refused the backup: " + opened)
const restoredRuns = runIds(restored)
if (!restoredRuns.includes("run-before-upgrade")) fail("the restored backup lost its pre-upgrade row")
const lost = upgradedRuns.filter((id) => !restoredRuns.includes(id))
console.log("3. rollback from backup opened with 1.0.0 source, runs: " + restoredRuns.join(", "))
console.log("   runs written after the upgrade and lost by the rollback: " + (lost.length ? lost.join(", ") : "none"))
console.log("DRILL OK")
