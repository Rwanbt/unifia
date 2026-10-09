-- SPDX-License-Identifier: MIT
-- Copyright (c) 2026 Unifia contributors
--
-- Team store 1.0.0 -> 1.1.0: each run belongs to one project.
-- Runs in place before this step keep project_id NULL, so no project lists them.
-- Applied only by team-store-schema.ts, once, inside BEGIN IMMEDIATE, after a backup
-- and only while team_store_meta does not yet record 1.1.0. SQLite has no
-- ADD COLUMN IF NOT EXISTS, so that version check is what stops a second run.

ALTER TABLE team_runs ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS team_runs_project_scope ON team_runs (project_id, created_at, run_id);

INSERT INTO team_store_meta (schema_version, migration_id, applied_at)
VALUES ('1.1.0', '20261009120000_team_project_scope', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
