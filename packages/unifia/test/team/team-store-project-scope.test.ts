// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { Database } from "bun:sqlite"
import { existsSync, readdirSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { TeamStore, TeamStoreCursorError, type TeamRunInput } from "../../src/team/team-store"
import { applyPendingUpgradesLocked, TeamStoreSchemaError } from "../../src/team/team-store-schema"
import { TEAM_STORE_PROJECT_SCOPE_SCHEMA_VERSION, TEAM_STORE_SCHEMA_VERSION } from "../../src/team/team-store.sql"

const BASE_MIGRATION = join(import.meta.dir, "../../migration/20260726193000_team_store/migration.sql")
const STORE_FILE = "team.db"
const PROJECT_A = { projectId: "project-a" }
const PROJECT_B = { projectId: "project-b" }

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

describe("TeamStore schema upgrade 1.0.0 -> current", () => {
  test("TeamStoreMigration_OpenVersionOneDatabase_KeepsRowsUnattributed", async () => {
    const path = await writeVersionOneDatabase(await newRoot(), ["run-legacy"])
    const store = openStore(path)
    expect(store.listAllRuns().items.map((run) => run.runId)).toEqual(["run-legacy"])
    expect(store.listRuns(PROJECT_A).items).toEqual([])
    expect(store.getRun("run-legacy", PROJECT_A)).toBeNull()
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
      expect(() => applyPendingUpgradesLocked(raceLoser)).not.toThrow()
    } finally {
      raceLoser.close()
    }
    expect(teamRunColumns(path).filter((column) => column === "project_id")).toHaveLength(1)
  })

  test("TeamStoreMigration_FreshDatabase_IsCreatedAtCurrentSchemaWithoutBackup", async () => {
    const root = await newRoot()
    const path = join(root, STORE_FILE)
    openStore(path)
    expect(recordedSchemaVersions(path)).toEqual(["1.0.0", TEAM_STORE_PROJECT_SCOPE_SCHEMA_VERSION, TEAM_STORE_SCHEMA_VERSION].sort())
    expect(backupFiles(root)).toEqual([])
  })

  test("TeamStoreMigration_DatabaseFromNewerBinary_IsRefusedAndNotModified", async () => {
    const path = await writeVersionOneDatabase(await newRoot(), [])
    const db = new Database(path)
    db.query("INSERT INTO team_store_meta(schema_version, migration_id, applied_at) VALUES ('9.9.9', 'future', ?)").run(
      new Date().toISOString(),
    )
    db.close()
    expect(() => TeamStore.open(path)).toThrow(TeamStoreSchemaError)
    expect(teamRunColumns(path)).not.toContain("project_id")
    expect(recordedSchemaVersions(path)).toEqual(["1.0.0", "9.9.9"])
  })
})

async function storeWithRunsOfTwoProjects(): Promise<TeamStore> {
  const store = openStore(join(await newRoot(), STORE_FILE))
  await store.createRun({ runId: "run-a", planId: "plan-a", projectId: PROJECT_A.projectId })
  await store.createRun({ runId: "run-b", planId: "plan-b", projectId: PROJECT_B.projectId })
  return store
}

describe("TeamStore project scope", () => {
  test("TeamStore_ListRunsForProjectA_ExcludesProjectBRuns", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(store.listRuns(PROJECT_A).items.map((run) => run.runId)).toEqual(["run-a"])
    expect(store.listRuns(PROJECT_B).items.map((run) => run.runId)).toEqual(["run-b"])
    expect(store.listAllRuns().items.map((run) => run.runId).sort()).toEqual(["run-a", "run-b"])
  })

  test("TeamStore_ListRunsWithCursorFromOtherProject_ReturnsTheSameErrorAsUnknownCursor", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(() => store.listRuns({ ...PROJECT_A, cursor: "run-b" })).toThrow(
      new TeamStoreCursorError("cursor run run-b no longer exists"),
    )
    expect(() => store.listRuns({ ...PROJECT_A, cursor: "run-ghost" })).toThrow(
      new TeamStoreCursorError("cursor run run-ghost no longer exists"),
    )
  })

  test("TeamStore_GetRunOfOtherProject_ReturnsNullLikeUnknownRun", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(store.getRun("run-b", PROJECT_A)).toBeNull()
    expect(store.getRun("run-ghost", PROJECT_A)).toBeNull()
    expect(store.getRun("run-b", PROJECT_B)?.runId).toBe("run-b")
  })

  test("TeamStore_TasksEventsAndGatesOfOtherProjectRun_ReturnEmpty", async () => {
    const store = await storeWithRunsOfTwoProjects()
    await store.createTask({ taskId: "task-b", runId: "run-b", scope: { files: ["src"] } })
    await store.appendEvent("run-b", "event-b", "test.kind", { ok: true })
    await store.recordGate({ gateId: "gate-b", runId: "run-b", verdict: "APPROVED", findings: {} })

    expect(store.listTasks("run-b", PROJECT_A)).toEqual([])
    expect(store.listEvents("run-b", PROJECT_A)).toEqual({ items: [], nextCursor: null })
    expect(store.listGates("run-b", PROJECT_A)).toEqual([])

    expect(store.listTasks("run-b", PROJECT_B).map((task) => task.taskId)).toEqual(["task-b"])
    expect(store.listEvents("run-b", PROJECT_B).items).toHaveLength(1)
    expect(store.listGates("run-b", PROJECT_B)).toHaveLength(1)
  })

  test("TeamStore_CreateRunWithEmptyProject_IsRejected", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(() => store.createRun({ runId: "run-empty", planId: "plan-c", projectId: "" })).toThrow(RangeError)
  })

  test("TeamStore_CreateRun_StampsCurrentSchemaVersion", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(store.getRun("run-a", PROJECT_A)?.schemaVersion).toBe(TEAM_STORE_SCHEMA_VERSION)
  })
})

describe("TeamStore database-level invariant", () => {
  test("TeamStore_CreateRunWithoutProject_IsRefusedByTheDatabase", async () => {
    const store = await storeWithRunsOfTwoProjects()
    const withoutProject = { runId: "run-unattributed", planId: "plan-c" } as unknown as TeamRunInput
    await expect(store.createRun(withoutProject)).rejects.toThrow(/requires a project_id/)
    expect(store.listAllRuns().items.map((run) => run.runId)).not.toContain("run-unattributed")
  })

  test("TeamStore_RawNullInsert_IsRefusedByTheTrigger", async () => {
    const path = join(await newRoot(), STORE_FILE)
    TeamStore.open(path).close()
    const db = new Database(path)
    try {
      expect(() =>
        db.query("INSERT INTO team_runs(run_id, schema_version, plan_id, status, created_at, updated_at) VALUES ('raw', '1.2.0', 'p', 'pending', 'now', 'now')").run(),
      ).toThrow(/requires a project_id/)
    } finally {
      db.close()
    }
  })

  test("TeamStore_ProjectOfRun_CannotBeChangedBySql", async () => {
    const path = join(await newRoot(), STORE_FILE)
    const store = openStore(path)
    await store.createRun({ runId: "run-a", planId: "plan-a", projectId: PROJECT_A.projectId })
    const db = new Database(path)
    try {
      expect(() => db.query("UPDATE team_runs SET project_id = 'project-b' WHERE run_id = 'run-a'").run()).toThrow(/immutable/)
      db.query("UPDATE team_runs SET status = 'running' WHERE run_id = 'run-a'").run()
    } finally {
      db.close()
    }
    expect(store.getRun("run-a", PROJECT_A)?.status).toBe("running")
    expect(store.getRun("run-a", PROJECT_B)).toBeNull()
  })

  test("TeamStore_LegacyRow_CannotBeAttributedBySql", async () => {
    const path = await writeVersionOneDatabase(await newRoot(), ["run-legacy"])
    TeamStore.open(path).close()
    const db = new Database(path)
    try {
      expect(() => db.query("UPDATE team_runs SET project_id = 'project-a' WHERE run_id = 'run-legacy'").run()).toThrow(/immutable/)
    } finally {
      db.close()
    }
    expect(readRows<{ project_id: string | null }>(path, "SELECT project_id FROM team_runs WHERE run_id = 'run-legacy'")).toEqual([
      { project_id: null },
    ])
  })

  test("TeamStore_TransitionTaskStatus_OfOtherProject_ChangesNothing", async () => {
    const store = await storeWithRunsOfTwoProjects()
    await store.createTask({ taskId: "task-b", runId: "run-b", scope: {} })
    await expect(
      store.transitionTaskStatus({
        runId: "run-b",
        taskId: "task-b",
        from: "pending",
        to: "running",
        eventId: "event-x",
        payload: { actor: "project-a" },
        scope: PROJECT_A,
      }),
    ).rejects.toThrow("Team task task-b does not exist")
    expect(store.listTasks("run-b", PROJECT_B)[0]?.status).toBe("pending")
    expect(store.listEvents("run-b", PROJECT_B).items).toEqual([])
  })

  test("TeamStore_GenerateProjectUpdate_OfOtherProject_WritesNothing", async () => {
    const store = await storeWithRunsOfTwoProjects()
    expect(await store.generateProjectUpdate("run-b", "update-x", PROJECT_A)).toBeNull()
    expect(store.count("team_events")).toBe(0)
  })

  test("TeamStore_LatestProjectUpdate_OfOtherProject_ReturnsNull", async () => {
    const store = await storeWithRunsOfTwoProjects()
    await store.generateProjectUpdate("run-b", "update-b", PROJECT_B)
    expect(store.latestProjectUpdate("run-b", PROJECT_A)).toBeNull()
    expect(store.latestProjectUpdate("run-b", PROJECT_B)?.eventId).toBe("update-b")
  })
})

/** Raw SQL, as any process with write access to the file can issue it. */
function insertRawRun(db: Database, verb: string, runId: string, projectId: string): void {
  db.query(
    `${verb} INTO team_runs(run_id, schema_version, plan_id, status, project_id, created_at, updated_at)
     VALUES (?, '1.2.0', 'plan-raw', 'pending', ?, 'now', 'now')`,
  ).run(runId, projectId)
}

describe("TeamStore database-level boundary", () => {
  test("TeamStore_RawBlankProjectInsert_IsRefusedByTheTrigger", async () => {
    const path = join(await newRoot(), STORE_FILE)
    TeamStore.open(path).close()
    const db = new Database(path)
    try {
      expect(() => insertRawRun(db, "INSERT", "run-empty", "")).toThrow(/requires a project_id/)
      expect(() => insertRawRun(db, "INSERT", "run-blank", "   ")).toThrow(/requires a project_id/)
    } finally {
      db.close()
    }
    expect(readRows<{ run_id: string }>(path, "SELECT run_id FROM team_runs")).toEqual([])
  })

  for (const verb of ["INSERT OR REPLACE", "INSERT OR IGNORE"]) {
    test(`TeamStore_${verb.replace(/ /g, "")}OverExistingRun_IsRefusedForAnyProject`, async () => {
      const path = join(await newRoot(), STORE_FILE)
      const store = openStore(path)
      await store.createRun({ runId: "run-a", planId: "plan-a", projectId: PROJECT_A.projectId })
      const db = new Database(path)
      try {
        expect(() => insertRawRun(db, verb, "run-a", PROJECT_B.projectId)).toThrow(/already used or was deleted/)
        expect(() => insertRawRun(db, verb, "run-a", PROJECT_A.projectId)).toThrow(/already used or was deleted/)
      } finally {
        db.close()
      }
      expect(store.getRun("run-a", PROJECT_A)?.runId).toBe("run-a")
      expect(store.getRun("run-a", PROJECT_B)).toBeNull()
      expect(store.count("team_runs")).toBe(1)
    })
  }

  test("TeamStore_RecreateDeletedRunId_IsRefusedSoOldChildRowsStayUnattached", async () => {
    const store = await storeWithRunsOfTwoProjects()
    await store.createTask({ taskId: "task-a", runId: "run-a", scope: {} })
    await store.deleteRunAudited("run-a", "retention policy")
    for (const scope of [PROJECT_A, PROJECT_B]) {
      await expect(store.createRun({ runId: "run-a", planId: "plan-new", projectId: scope.projectId })).rejects.toThrow(
        /already used or was deleted/,
      )
    }
    expect(store.listTasks("run-a", PROJECT_B)).toEqual([])
    expect(store.count("team_audit")).toBe(1)
  })
})
