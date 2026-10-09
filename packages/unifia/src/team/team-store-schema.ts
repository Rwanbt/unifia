// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import type { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
// WHY: text import, like the base migration: the SQL must be inlined into the
// single-file executable, where the source tree does not exist at runtime.
import PROJECT_SCOPE_UPGRADE from "./schema-upgrades/1.1.0-project-scope.sql" with { type: "text" }
import { TEAM_STORE_BASE_SCHEMA_VERSION, TEAM_STORE_SCHEMA_VERSION } from "./team-store.sql"

const KNOWN_SCHEMA_VERSIONS: readonly string[] = [TEAM_STORE_BASE_SCHEMA_VERSION, TEAM_STORE_SCHEMA_VERSION]
const IN_MEMORY_DATABASE = ":memory:"
/** Holds the version ledger once upgraded; `team_store_meta` is then a read-only view over it. */
const VERSION_LEDGER_TABLE = "team_store_ledger"
const BASE_VERSION_TABLE = "team_store_meta"

/** The database was written by a newer binary, or is not a Team store. Nothing was changed. */
export class TeamStoreSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TeamStoreSchemaError"
  }
}

export function tableExists(db: Database, tableName: string): boolean {
  return db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) !== null
}

/** True once the ledger exists. From then on the base migration must not run: its meta insert is a write to a view. */
export function isUpgradedTeamStore(db: Database): boolean {
  return tableExists(db, VERSION_LEDGER_TABLE)
}

function recordedSchemaVersions(db: Database): string[] {
  const table = isUpgradedTeamStore(db) ? VERSION_LEDGER_TABLE : BASE_VERSION_TABLE
  const rows = db.query(`SELECT schema_version FROM ${table}`).all() as { schema_version: string }[]
  return rows.map((row) => row.schema_version)
}

function refuseUnknownVersions(recorded: readonly string[]): void {
  const unknown = recorded.filter((version) => !KNOWN_SCHEMA_VERSIONS.includes(version))
  if (unknown.length === 0) return
  throw new TeamStoreSchemaError(
    `team.db records schema ${unknown.join(", ")}, which this binary does not support (latest ${TEAM_STORE_SCHEMA_VERSION}). It was not opened or modified.`,
  )
}

function backupPath(databasePath: string): string {
  const preferred = `${databasePath}.bak-${TEAM_STORE_BASE_SCHEMA_VERSION}`
  return existsSync(preferred) ? `${preferred}-${Date.now()}` : preferred
}

/**
 * `VACUUM INTO` writes a consistent copy that includes WAL content; a raw file
 * copy of a WAL database can miss committed rows.
 */
function backupBeforeUpgrade(db: Database, databasePath: string): void {
  if (databasePath === IN_MEMORY_DATABASE) return
  db.query("VACUUM INTO ?").run(backupPath(databasePath))
}

/**
 * Bring the database to the current schema, once.
 *
 * An already-upgraded database is recognised from `team_store_meta` and left
 * alone: the ALTER is never replayed. `hadRunsTable` is false when this open
 * created the database, so there is no data to back up.
 */
export function upgradeTeamStoreSchema(db: Database, options: { databasePath: string; hadRunsTable: boolean }): void {
  const recorded = recordedSchemaVersions(db)
  refuseUnknownVersions(recorded)
  if (recorded.includes(TEAM_STORE_SCHEMA_VERSION)) return
  if (options.hadRunsTable) backupBeforeUpgrade(db, options.databasePath)
  applyProjectScopeUpgradeLocked(db)
}

/**
 * Applies the 1.1.0 step under the write lock. The version is read again there:
 * another process may have upgraded while this one was taking the backup, and an
 * ALTER TABLE cannot be replayed. Exported so the guard can be tested without a race.
 */
export function applyProjectScopeUpgradeLocked(db: Database): void {
  db.exec("BEGIN IMMEDIATE")
  try {
    if (!recordedSchemaVersions(db).includes(TEAM_STORE_SCHEMA_VERSION)) db.exec(PROJECT_SCOPE_UPGRADE)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}
