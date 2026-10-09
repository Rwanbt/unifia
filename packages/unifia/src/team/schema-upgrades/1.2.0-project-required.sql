-- SPDX-License-Identifier: MIT
-- Copyright (c) 2026 Unifia contributors
--
-- Team store 1.1.0 -> 1.2.0: a run cannot be created without a project, and cannot
-- change project afterwards. Legacy rows keep project_id NULL, so they stay in
-- quarantine: no statement in this step attributes them to a project.
--
-- These triggers apply to the new binary. A 1.0.0 binary never opens an upgraded
-- store (see 1.1.0), so the guard does not depend on what older code happens to do.

CREATE TRIGGER team_runs_project_required
BEFORE INSERT ON team_runs
WHEN NEW.project_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'team run requires a project_id');
END;

CREATE TRIGGER team_runs_project_frozen
BEFORE UPDATE OF project_id ON team_runs
WHEN NEW.project_id IS NOT OLD.project_id
BEGIN
  SELECT RAISE(ABORT, 'team run project_id is immutable');
END;

INSERT INTO team_store_ledger (schema_version, migration_id, applied_at)
VALUES ('1.2.0', '20261009130000_team_project_required', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
