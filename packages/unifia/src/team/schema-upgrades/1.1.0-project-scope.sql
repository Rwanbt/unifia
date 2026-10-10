-- SPDX-License-Identifier: MIT
-- Copyright (c) 2026 Unifia contributors
--
-- Team store 1.0.0 -> 1.1.0: each run belongs to one project.
-- Runs in place before this step keep project_id NULL, so no project lists them.
--
-- The version ledger moves to team_store_ledger, and team_store_meta becomes a view
-- over it. A 1.0.0 binary runs `INSERT OR IGNORE INTO team_store_meta` on every open,
-- and SQLite refuses any write to a view that has no INSTEAD OF trigger. So a 1.0.0
-- binary fails at open, before it reads or writes a single row. OR IGNORE does not
-- cover this error, which is why a trigger on the ledger was not enough.
--
-- Applied only by team-store-schema.ts, once, inside BEGIN IMMEDIATE, after a backup,
-- and only while the ledger does not yet record 1.1.0.

ALTER TABLE team_store_meta RENAME TO team_store_ledger;

CREATE VIEW team_store_meta AS
  SELECT schema_version, migration_id, applied_at FROM team_store_ledger;

ALTER TABLE team_runs ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS team_runs_project_scope ON team_runs (project_id, created_at, run_id);

INSERT INTO team_store_ledger (schema_version, migration_id, applied_at)
VALUES ('1.1.0', '20261009120000_team_project_scope', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
