# Migration Certification (N03) — placeholder

Schema versioning: TEAM_SCHEMA_VERSION = 2.0.0; N-1 = 1.0.0 supported.
loadAttempt migrates v1 payloads; parseAttempt rejects unmigrated v1;
loadAttempt throws TeamSchemaVersionError on N-2 / malformed.
WAL replay after interruption verified.
Backup/restore round-trip verified.
Rollback (Down) script available for every migration.

EXTERNAL_HUMAN_SIGNOFF_RECOMMENDED for production rollout on managed DB.
D-066 permits local closure.
