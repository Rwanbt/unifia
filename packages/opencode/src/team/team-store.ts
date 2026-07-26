import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  TEAM_STORE_MAX_EVENT_BYTES,
  TEAM_STORE_MAX_JSON_BYTES,
  TEAM_STORE_SCHEMA_VERSION,
  TEAM_STORE_TABLES,
  type TeamStoreTable,
} from "./team-store.sql"

const DEFAULT_QUEUE_LIMIT = 256
const MIGRATION_FILE = resolve(import.meta.dir, "../../migration/20260726193000_team_store/migration.sql")

export class TeamStoreQueueFullError extends Error {
  constructor(limit: number) {
    super(`Team store writer queue is full (limit ${limit})`)
    this.name = "TeamStoreQueueFullError"
  }
}

export interface TeamStoreOptions {
  queueLimit?: number
}

export interface TeamRunInput {
  runId: string
  planId: string
  status?: "pending" | "running" | "completed" | "failed" | "aborted"
}

export interface TeamTaskInput {
  taskId: string
  runId: string
  status?: "pending" | "assigned" | "running" | "completed" | "blocked" | "cancelled"
  dependsOn?: string[]
  scope: unknown
}

function now(): string {
  return new Date().toISOString()
}

function json(value: unknown, maxBytes: number, field: string): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError(`${field} must be JSON serializable`)
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw new RangeError(`${field} exceeds the ${maxBytes}-byte limit`)
  }
  return encoded
}

export class TeamStore {
  readonly #db: Database
  readonly #queueLimit: number
  #queuedWrites = 0
  #writerTail: Promise<void> = Promise.resolve()

  private constructor(db: Database, options: TeamStoreOptions = {}) {
    this.#db = db
    this.#queueLimit = options.queueLimit ?? DEFAULT_QUEUE_LIMIT
  }

  static open(path: string, options: TeamStoreOptions = {}): TeamStore {
    const db = new Database(path, { create: true })
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
    db.exec(readFileSync(MIGRATION_FILE, "utf8"))
    return new TeamStore(db, options)
  }

  get journalMode(): string {
    return String((this.#db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toLowerCase()
  }

  get busyTimeoutMs(): number {
    return Number((this.#db.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout)
  }

  get queuedWrites(): number {
    return this.#queuedWrites
  }

  count(table: TeamStoreTable): number {
    if (!TEAM_STORE_TABLES.includes(table)) throw new Error(`Unknown TeamStore table: ${table}`)
    return Number((this.#db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
  }

  write<T>(operation: (db: Database) => T): Promise<T> {
    if (this.#queuedWrites >= this.#queueLimit) throw new TeamStoreQueueFullError(this.#queueLimit)
    this.#queuedWrites++
    const run = this.#writerTail.then(() => operation(this.#db))
    this.#writerTail = run.then(
      () => {
        this.#queuedWrites--
      },
      () => {
        this.#queuedWrites--
      },
    )
    return run
  }

  transaction<T>(operation: (db: Database) => T): Promise<T> {
    return this.write((db) => db.transaction(() => operation(db))())
  }

  createRun(input: TeamRunInput): Promise<void> {
    return this.write((db) => {
      const timestamp = now()
      db.prepare(
        `INSERT INTO team_runs(run_id, schema_version, plan_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.runId, TEAM_STORE_SCHEMA_VERSION, input.planId, input.status ?? "pending", timestamp, timestamp)
    })
  }

  createTask(input: TeamTaskInput): Promise<void> {
    const dependsOn = json(input.dependsOn ?? [], TEAM_STORE_MAX_JSON_BYTES, "dependsOn")
    const scope = json(input.scope, TEAM_STORE_MAX_JSON_BYTES, "scope")
    return this.write((db) => {
      const timestamp = now()
      db.prepare(
        `INSERT INTO team_tasks(task_id, run_id, status, depends_on_json, scope_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.taskId, input.runId, input.status ?? "pending", dependsOn, scope, timestamp, timestamp)
    })
  }

  appendEvent(runId: string, eventId: string, kind: string, payload: unknown): Promise<number> {
    const payloadJson = json(payload, TEAM_STORE_MAX_EVENT_BYTES, "event payload")
    return this.write((db) => {
      const row = db
        .query("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM team_events WHERE run_id = ?")
        .get(runId) as { next_sequence: number }
      db.prepare(
        `INSERT INTO team_events(event_id, run_id, sequence, kind, payload_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(eventId, runId, row.next_sequence, kind, payloadJson, now())
      return row.next_sequence
    })
  }

  saveCheckpoint(runId: string, checkpointId: string, state: unknown): Promise<number> {
    const stateJson = json(state, TEAM_STORE_MAX_JSON_BYTES, "checkpoint state")
    return this.write((db) => {
      const row = db
        .query("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM team_checkpoints WHERE run_id = ?")
        .get(runId) as { next_sequence: number }
      db.prepare(
        `INSERT INTO team_checkpoints(checkpoint_id, run_id, sequence, state_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(checkpointId, runId, row.next_sequence, stateJson, now())
      return row.next_sequence
    })
  }

  recordArtifact(input: {
    artifactId: string
    runId: string
    taskId?: string
    relativePath: string
    sha256: string
    byteLength: number
    metadata?: unknown
  }): Promise<void> {
    const metadata = input.metadata === undefined ? null : json(input.metadata, TEAM_STORE_MAX_JSON_BYTES, "artifact metadata")
    return this.write((db) => {
      db.prepare(
        `INSERT INTO team_artifacts(artifact_id, run_id, task_id, relative_path, sha256, byte_length, metadata_json, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.artifactId, input.runId, input.taskId ?? null, input.relativePath, input.sha256, input.byteLength, metadata, now())
    })
  }

  compactEvents(runId: string, keepLatest: number): Promise<number> {
    if (!Number.isInteger(keepLatest) || keepLatest < 0) throw new RangeError("keepLatest must be a non-negative integer")
    return this.transaction((db) => {
      const deleted = db
        .prepare(
          `DELETE FROM team_events WHERE run_id = ? AND sequence <= (
             SELECT COALESCE(MAX(sequence), 0) - ? FROM team_events WHERE run_id = ?
           )`,
        )
        .run(runId, keepLatest, runId)
      return deleted.changes
    })
  }

  deleteRunAudited(runId: string, reason: string): Promise<void> {
    const details = json({ reason }, 16 * 1024, "audit details")
    return this.transaction((db) => {
      db.prepare(
        `INSERT INTO team_audit(audit_id, run_id, action, target_id, details_json, recorded_at)
         VALUES (?, ?, 'DELETE_RUN', ?, ?, ?)`,
      ).run(crypto.randomUUID(), runId, runId, details, now())
      db.prepare("DELETE FROM team_runs WHERE run_id = ?").run(runId)
    })
  }

  integrityCheck(): { ok: boolean; foreignKeys: string[]; quickCheck: string } {
    const quickCheck = String((this.#db.query("PRAGMA quick_check").get() as { quick_check: string }).quick_check)
    const foreignKeys = this.#db.query("PRAGMA foreign_key_check").all() as string[]
    return { ok: quickCheck === "ok" && foreignKeys.length === 0, foreignKeys, quickCheck }
  }

  close(): void {
    this.#db.close()
  }
}
