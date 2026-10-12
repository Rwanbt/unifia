// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { Database } from "bun:sqlite"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { TeamStore } from "../../src/team/team-store"

const BASE_MIGRATION = join(import.meta.dir, "../../migration/20260726193000_team_store/migration.sql")
const STORE_FILE = "team.db"
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true })
    } catch {
      /* Windows releases SQLite handles shortly after close. */
    }
  }
})

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "opencode-team-restore-"))
  roots.push(root)
  return root
}

/** A store as the 1.0.0 binary left it: its base migration, then the rows it wrote. */
async function writeVersionOneStore(path: string, runIds: string[]): Promise<void> {
  const db = new Database(path, { create: true })
  db.exec(await Bun.file(BASE_MIGRATION).text())
  const timestamp = new Date().toISOString()
  for (const runId of runIds) {
    db.query(
      "INSERT INTO team_runs(run_id, schema_version, plan_id, status, created_at, updated_at) VALUES (?, '1.0.0', 'plan-legacy', 'completed', ?, ?)",
    ).run(runId, timestamp, timestamp)
  }
  db.close()
}

function readRunIds(path: string): string[] {
  const db = new Database(path, { readonly: true })
  try {
    return (db.query("SELECT run_id FROM team_runs ORDER BY run_id").all() as { run_id: string }[]).map((row) => row.run_id)
  } finally {
    db.close()
  }
}

function hasProjectColumn(path: string): boolean {
  const db = new Database(path, { readonly: true })
  try {
    return (db.query("PRAGMA table_info(team_runs)").all() as { name: string }[]).some((column) => column.name === "project_id")
  } finally {
    db.close()
  }
}

// Drill on copies only: the live store is never restored in these tests.
describe("TeamStore restore from the pre-upgrade backup", () => {
  test("TeamStoreRestore_BackupTakenBeforeUpgrade_RestoresTheOriginalRows", async () => {
    const root = await newRoot()
    const path = join(root, STORE_FILE)
    await writeVersionOneStore(path, ["run-legacy-1", "run-legacy-2"])

    TeamStore.open(path).close()
    expect(hasProjectColumn(path)).toBe(true)

    await copyFile(join(root, `${STORE_FILE}.bak-1.0.0`), path)

    expect(hasProjectColumn(path)).toBe(false)
    expect(readRunIds(path)).toEqual(["run-legacy-1", "run-legacy-2"])
  })

  test("TeamStoreRestore_RestoredStore_UpgradesAgainWithoutLosingRows", async () => {
    const root = await newRoot()
    const path = join(root, STORE_FILE)
    await writeVersionOneStore(path, ["run-legacy-1"])
    TeamStore.open(path).close()
    await copyFile(join(root, `${STORE_FILE}.bak-1.0.0`), path)

    TeamStore.open(path).close()

    expect(hasProjectColumn(path)).toBe(true)
    expect(readRunIds(path)).toEqual(["run-legacy-1"])
  })

  test("TeamStoreRestore_RestoredStore_CanBeReadByTheVersionOneSchemaAgain", async () => {
    const root = await newRoot()
    const path = join(root, STORE_FILE)
    await writeVersionOneStore(path, ["run-legacy-1"])
    TeamStore.open(path).close()
    await copyFile(join(root, `${STORE_FILE}.bak-1.0.0`), path)

    // The rollback: a 1.0.0 binary opens the restored file with its own base migration.
    const baseMigration = await Bun.file(BASE_MIGRATION).text()
    const oldBinary = new Database(path)
    try {
      expect(() => oldBinary.exec(baseMigration)).not.toThrow()
    } finally {
      oldBinary.close()
    }
    expect(readRunIds(path)).toEqual(["run-legacy-1"])
  })
})
