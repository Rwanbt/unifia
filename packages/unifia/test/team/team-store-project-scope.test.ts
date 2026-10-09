// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { Database } from "bun:sqlite"
import { existsSync, readdirSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { TeamStore, TeamStoreCursorError } from "../../src/team/team-store"
import { applyProjectScopeUpgradeLocked, TeamStoreSchemaError } from "../../src/team/team-store-schema"
import { TEAM_STORE_SCHEMA_VERSION } from "../../src/team/team-store.sql"

const BASE_MIGRATION = join(import.meta.dir, "../../migration/20260726193000_team_store/migration.sql")
const STORE_FILE = "team.db"

const roots: string[] = []
const stores: TeamStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await new Promise((resolve) => setTimeout(resolve, 25))
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true })
    } catch {
      /* Windows may release SQLite handles shortly after close. */
    }
  }
})

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "opencode-team-scope-"))
  roots.push(root)
  return root
}

function openStore(path: string): TeamStore {
  const store = TeamStore.open(path)
  stores.push(store)
  return store
}

/** A database as the 1.0.0 binary left it: its base migration, then the rows it wrote. */
async function writeVersionOneDatabase(root: string, runIds: string[]): Promise<string> {
  const path = join(root, STORE_FILE)
  const db = new Database(path, { create: true })
  db.exec(await readFile(BASE_MIGRATION, "utf8"))
  const timestamp = new Date().toISOString()
  for (const runId of runIds) {
    db.query(
      "INSERT INTO team_runs(run_id, schema_version, plan_id, status, created_at, updated_at) VALUES (?, '1.0.0', 'plan-legacy', 'completed', ?, ?)",
    ).run(runId, timestamp, timestamp)
  }
  db.close()
  return path
}

function readRows<Row>(path: string, sql: string): Row[] {
  const db = new Database(path, { readonly: true })
  try {
    return db.query(sql).all() as Row[]
  } finally {
    db.close()
  }
}

function teamRunColumns(path: string): string[] {
  return readRows<{ name: string }>(path, "PRAGMA table_info(team_runs)").map((column) => column.name)
}

function recordedSchemaVersions(path: string): string[] {
  return readRows<{ schema_version: string }>(path, "SELECT schema_version FROM team_store_meta ORDER BY schema_version").map(
    (row) => row.schema_version,
  )
}

function backupFiles(root: string): string[] {
  return readdirSync(root).filter((name) => name.includes(".bak"))
}

describe("TeamStore schema upgrade 1.0.0 -> 1.1.0", () => {
  test("TeamStoreMigration_OpenVersionOneDatabase_KeepsRowsUnattributed", async () => {
    const path = await writeVersionOneDatabase(await newRoot(), ["run-legacy"])
    const store = openStore(path)
    expect(store.listRuns().items.map((run) => run.runId)).toEqual(["run-legacy"])
    expect(store.listRuns({ projectId: "project-a" }).items).toEqual([])
    expect(store.getRun("run-legacy", { projectId: "project-a" })).toBeNull()
    expect(store.getRun("run-legacy")).not.toBeNull()
  })

  test("TeamStoreMigration_OpenVersionOneDatabase_BacksUpFileBeforeChanging", async () => {
    const root = await newRoot()
    const path = await writeVersionOneDatabase(root, ["run-legacy"])
    openStore(path)
    const backup = join(root, `${STORE_FILE}.bak-1.0.0`)
    expect(existsSync(backup)).toBe(true)
    expect(teamRunColumns(backup)).not.toContain("project_id")
    expect(readRows<{ run_id: string }>(backup, "SELECT run_id FROM team_runs")).toEqual([{ run_id: "run-legacy" }])
  })

  test("TeamStoreMigration_ReopenUpgradedDatabase_DoesNotReplayAlterOrBackup", async () => {
    const root = await newRoot()
    const path = await writeVersionOneDatabase(root, [])
    TeamStore.open(path).close()
    openStore(path)
    expect(recordedSchemaVersions(path).filter((version) => version === TEAM_STORE_SCHEMA_VERSION)).toHaveLength(1)
    expect(teamRunColumns(path).filter((column) => column === "project_id")).toHaveLength(1)
    expect(backupFiles(root)).toHaveLength(1)
  })

  test("TeamStoreMigration_UpgradedDatabase_RefusesVersionOneBaseMigration", async () => {
    const path = await writeVersionOneDatabase(await newRoot(), ["run-legacy"])
    TeamStore.open(path).close()
    const baseMigration = await readFile(BASE_MIGRATION, "utf8")
    const legacyBinaryOpen = new Database(path)
    try {
      expect(() => legacyBinaryOpen.exec(baseMigration)).toThrow(/cannot modify team_store_meta/)
    } finally {
      legacyBinaryOpen.close()
    }
    expect(readRows<{ run_id: string }>(path, "SELECT run_id FROM team_runs")).toEqual([{ run_id: "run-legacy" }])
  })

  test("TeamStoreMigration_LockedUpgradeOnUpgradedDatabase_DoesNotReplayAlter", async () => {
    const path = await writeVersionOneDatabase(await newRoot(), ["run-legacy"])
    TeamStore.open(path).close()
    const raceLoser = new Database(path)
    try {
      expect(() => applyProjectScopeUpgradeLocked(raceLoser)).not.toThrow()
    } finally {
      raceLoser.close()
    }
    expect(teamRunColumns(path).filter((column) => column === "project_id")).toHaveLength(1)
  })

  test("TeamStoreMigration_FreshDatabase_IsCreatedAtCurrentSchemaWithoutBackup", async () => {
    const root = await newRoot()
    const path = join(root, STORE_FILE)
    openStore(path)
    expect(recordedSchemaVersions(path)).toEqual(["1.0.0", TEAM_STORE_SCHEMA_VERSION])
    expect(backupFiles(root)).toEqual([])
  })

  test("TeamStoreMigration_DatabaseFromNewerBinary_IsRefusedAndNotModified", async () => {
    const path = await writeVersionOneDatabase(await newRoot(), [])
    const db = new Database(path)
    db.query("INSERT INTO team_store_meta(schema_version, migration_id, applied_at) VALUES ('2.0.0', 'future', ?)").run(
      new Date().toISOString(),
    )
    db.close()
    expect(() => TeamStore.open(path)).toThrow(TeamStoreSchemaError)
    expect(teamRunColumns(path)).not.toContain("project_id")
    expect(recordedSchemaVersions(path)).toEqual(["1.0.0", "2.0.0"])
  })
})

describe("TeamStore project scope", () => {
  async function storeWithRunsOfTwoProjects(): Promise<TeamStore> {
    const store = openStore(join(await newRoot(), STORE_FILE))
    await store.createRun({ runId: "run-a", planId: "plan-a", projectId: "project-a" })
    await store.createRun({ runId: "run-b", planId: "plan-b", projectId: "project-b" })
    return store
  }

  test("TeamStore_ListRunsForProjectA_ExcludesProjectBRuns", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(store.listRuns({ projectId: "project-a" }).items.map((run) => run.runId)).toEqual(["run-a"])
    expect(store.listRuns({ projectId: "project-b" }).items.map((run) => run.runId)).toEqual(["run-b"])
    expect(store.listRuns().items.map((run) => run.runId).sort()).toEqual(["run-a", "run-b"])
  })

  test("TeamStore_ListRunsWithCursorFromOtherProject_ReturnsTheSameErrorAsUnknownCursor", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(() => store.listRuns({ projectId: "project-a", cursor: "run-b" })).toThrow(
      new TeamStoreCursorError("cursor run run-b no longer exists"),
    )
    expect(() => store.listRuns({ projectId: "project-a", cursor: "run-ghost" })).toThrow(
      new TeamStoreCursorError("cursor run run-ghost no longer exists"),
    )
  })

  test("TeamStore_GetRunOfOtherProject_ReturnsNullLikeUnknownRun", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(store.getRun("run-b", { projectId: "project-a" })).toBeNull()
    expect(store.getRun("run-ghost", { projectId: "project-a" })).toBeNull()
    expect(store.getRun("run-b", { projectId: "project-b" })?.runId).toBe("run-b")
  })

  test("TeamStore_TasksEventsAndGatesOfOtherProjectRun_ReturnEmpty", async () => {
    const store = await storeWithRunsOfTwoProjects()
    await store.createTask({ taskId: "task-b", runId: "run-b", scope: { files: ["src"] } })
    await store.appendEvent("run-b", "event-b", "test.kind", { ok: true })
    await store.recordGate({ gateId: "gate-b", runId: "run-b", verdict: "APPROVED", findings: {} })

    expect(store.listTasks("run-b", { projectId: "project-a" })).toEqual([])
    expect(store.listEvents("run-b", { projectId: "project-a" })).toEqual({ items: [], nextCursor: null })
    expect(store.listGates("run-b", { projectId: "project-a" })).toEqual([])

    expect(store.listTasks("run-b", { projectId: "project-b" }).map((task) => task.taskId)).toEqual(["task-b"])
    expect(store.listEvents("run-b", { projectId: "project-b" }).items).toHaveLength(1)
    expect(store.listGates("run-b", { projectId: "project-b" })).toHaveLength(1)
  })

  test("TeamStore_CreateRunWithoutProject_IsHiddenFromEveryProjectButListedUnscoped", async () => {
    const store = await storeWithRunsOfTwoProjects()
    await store.createRun({ runId: "run-unattributed", planId: "plan-c" })
    expect(store.listRuns({ projectId: "project-a" }).items.map((run) => run.runId)).toEqual(["run-a"])
    expect(store.listRuns().items.map((run) => run.runId)).toContain("run-unattributed")
  })

  test("TeamStore_CreateRunWithEmptyProject_IsRejected", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(() => store.createRun({ runId: "run-empty", planId: "plan-c", projectId: "" })).toThrow(RangeError)
  })

  test("TeamStore_CreateRun_StampsCurrentSchemaVersion", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(store.getRun("run-a")?.schemaVersion).toBe(TEAM_STORE_SCHEMA_VERSION)
  })
})
