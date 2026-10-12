<!-- SPDX-License-Identifier: MIT -->
# Team store: upgrade, incompatibility and rollback

Status: implemented on the cumulative Team branch (PRs #429, #430, #431). Covers the
store versions 1.0.0 → 1.1.0 → 1.2.0.

## What each version changes

| Version | Change | Backup |
|---|---|---|
| 1.0.0 | Runs have no project. | none |
| 1.1.0 | Each run belongs to one project. Existing runs keep `project_id` NULL and are quarantined: no project lists them. The version ledger moves to `team_store_ledger`, and `team_store_meta` becomes a view over it. | `team.db.bak-1.0.0`, written with `VACUUM INTO` before the first change |
| 1.2.0 | A run needs a non-blank project and cannot change project. Its run id cannot be reused after an audited deletion, nor renamed by `UPDATE`. | none (the 1.1.0 backup is the one to use) |

The backup is written once, by the first upgrade that changes the store. Reopening an
upgraded store does not take another backup.

## Incompatibility with version 1.0.0 (intended)

A 1.0.0 binary cannot open an upgraded store. It refuses at open with
`cannot modify team_store_meta because it is a view`, before it reads or writes a row.
This is deliberate: a 1.0.0 binary would otherwise insert runs with no project, which
1.1.0 quarantines.

## What was verified, and how

Two different checks, and they are not the same evidence:

1. **Schema compatibility (SQL).** `test/team/team-store-project-scope.test.ts` and
   `test/team/team-store-restore.test.ts` replay the 1.0.0 base migration against upgraded
   and restored files. This shows that the schema behaves as 1.0.0 expects. It does not run
   1.0.0 code.
2. **Real 1.0.0 source under Bun (drill).** `script/team-rollback-drill.ts` imports the
   `team-store.ts` of a 1.0.0 checkout and calls its real `TeamStore.open` on copies. Result
   on 2026-10-10 with the 1.0.0 source of `dev`:

   ```
   1. upgrade ok, runs: run-after-upgrade, run-before-upgrade
   2. 1.0.0 source refused the upgraded store: cannot modify team_store_meta because it is a view
   3. rollback from backup opened with 1.0.0 source, runs: run-before-upgrade
      runs written after the upgrade and lost by the rollback: run-after-upgrade
   DRILL OK
   ```

   This runs the 1.0.0 *source*. It does not run the packaged 1.0.0 executable, which was
   not built or launched for this drill.

## Rollback procedure

Rolling back from a backup **loses every run written after the upgrade**. The drill above
shows it.

1. Stop the Unifia application and any CLI process that can write the store.
2. Keep a copy of the current upgraded store, so the runs written after the upgrade can be
   recovered by hand: `copy team.db team.db.upgraded-<date>`.
3. Copy the backup over the store: `copy team.db.bak-1.0.0 team.db`.
4. Start the version 1.0.0 build. It opens the restored store with the rows that existed
   before the upgrade.
5. To return to the new version, start it again: it upgrades the restored store, and
   the backup is not rewritten.

Before any rollback, take a fresh copy of the store. The backup is the state at the first
upgrade, not the state at the rollback.

## What the drill does not cover

- The packaged 1.0.0 executable, and its behaviour on Windows and Android.
- Concurrent writers during the copy. The procedure assumes the application is stopped.
- Runs written by another machine that shares the store file. The store is local.

## Running the drill

```
cd packages/unifia
bun run script/team-rollback-drill.ts <path-to-1.0.0-team-store.ts> <empty-working-dir>
```

The drill writes only into the working directory. Exit code 0 means the three checks held.
