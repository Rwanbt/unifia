-- SPDX-License-Identifier: MIT
-- Copyright (c) 2026 Unifia contributors
--
-- Team store 1.1.0 -> 1.2.0: a run cannot be created without a project, and cannot
-- change project afterwards. Legacy rows keep project_id NULL, so they stay in
-- quarantine: no statement in this step attributes them to a project.
--
-- The boundary is what SQL can enforce, not an absolute guarantee: any process
-- that can write the database file can run SQL. These triggers close the paths
-- that a plain statement can take around the store's own checks:
--   - a blank project_id (an empty string is not NULL, so it passed before);
--   - INSERT OR REPLACE / OR IGNORE over a run that exists, under any project;
--   - a run id reused after an audited deletion, which would attach the rows that
--     deleteRunAudited leaves behind (they are keyed by run_id, with no foreign key).
-- A BEFORE INSERT trigger runs before the conflict check, so the OR clause cannot
-- skip it. Deletion stays allowed: it is audited in team_audit and the tombstone
-- it leaves is what keeps the run id from coming back.
--
-- These triggers apply to the new binary. A 1.0.0 binary never opens an upgraded
-- store (see 1.1.0), so the guard does not depend on what older code happens to do.

CREATE TRIGGER team_runs_project_required
BEFORE INSERT ON team_runs
WHEN NEW.project_id IS NULL OR trim(NEW.project_id, char(9, 10, 11, 12, 13, 32)) = ''
BEGIN
  SELECT RAISE(ABORT, 'team run requires a project_id');
END;

CREATE TRIGGER team_runs_id_is_fresh
BEFORE INSERT ON team_runs
WHEN EXISTS (SELECT 1 FROM team_runs WHERE run_id = NEW.run_id)
  OR EXISTS (SELECT 1 FROM team_audit WHERE action = 'DELETE_RUN' AND target_id = NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'team run id is already used or was deleted');
END;

CREATE TRIGGER team_runs_project_frozen
BEFORE UPDATE OF project_id ON team_runs
WHEN NEW.project_id IS NOT OLD.project_id
BEGIN
  SELECT RAISE(ABORT, 'team run project_id is immutable');
END;

INSERT INTO team_store_ledger (schema_version, migration_id, applied_at)
VALUES ('1.2.0', '20261009130000_team_project_required', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
