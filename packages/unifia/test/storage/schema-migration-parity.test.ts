/* SPDX-License-Identifier: MIT */

// Every column a Drizzle table declares must exist once all migrations have
// run. collab_user_token declared time_updated (via Timestamps) that no
// migration created, which broke every collaborative login at insert time;
// this guard catches the next such drift at test time instead.
import { expect, test } from "bun:test"
import { is, sql } from "drizzle-orm"
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core"
import { Database } from "../../src/storage/db"

const MODULES = [
  "../../src/account/account.sql",
  "../../src/collective/debate-store.sql",
  "../../src/control-plane/workspace.sql",
  "../../src/observability/content-optin.sql",
  "../../src/observability/event.sql",
  "../../src/project/project.sql",
  "../../src/rag/bm25.sql",
  "../../src/rag/rag.sql",
  "../../src/session/audit.sql",
  "../../src/session/session.sql",
  "../../src/share/share.sql",
  "../../src/sync/event.sql",
  "../../src/team/team-store.sql",
  "../../src/user/user.sql",
]

test("every Drizzle column exists after migrations", async () => {
  const tables: SQLiteTable[] = []
  for (const path of MODULES) {
    const module = (await import(path)) as Record<string, unknown>
    for (const value of Object.values(module)) if (is(value, SQLiteTable)) tables.push(value)
  }
  expect(tables.length).toBeGreaterThan(10)

  const missing: string[] = []
  for (const table of tables) {
    const config = getTableConfig(table)
    const rows = Database.use((db) => db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${config.name}")`)))
    const present = new Set(rows.map((row) => row.name))
    if (present.size === 0) {
      missing.push(`${config.name} (table)`)
      continue
    }
    for (const column of config.columns) if (!present.has(column.name)) missing.push(`${config.name}.${column.name}`)
  }
  expect(missing).toEqual([])
})
