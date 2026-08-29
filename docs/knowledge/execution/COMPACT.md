<!-- SPDX-License-Identifier: MIT -->
# COMPACT — Sovereign Knowledge Core V1 (session compact view)

> Vue compacte pour reprise rapide après compaction de session.
> Voir `FINAL-REPORT.md` pour le détail et `STATE.md` pour
> l'append-only historique.

## One-liner

40 commits locaux, 398 tests passants, 13 phases couvertes
(67+ cartes, P10.2 + P10.3 = `NOT_EXECUTED_EXTERNAL_BOUNDARY`).

## SHA

- Branche : `feat/sovereign-knowledge-core`
- HEAD : `36e0000363`
- Initial : `95350647140a382ee6d5d61bc2f6639597d80f0b`

## Files at a glance

- Contrats : `packages/contracts/src/knowledge/` (10 fichiers).
- Runtime TS : `packages/unifia/src/knowledge/` (37 modules).
- Runtime Rust : `crates/unifia-knowledge-core/src/` (8 modules).
- CLI : `packages/unifia/bin/unifia-knowledge.ts` (20 subcommands).
- Tests : 398 passants (285 TS + 79 contracts + 34 Rust).
- Docs : 9 ADR + 10 cas + DoD + crash matrix + CHANGELOG + README
  + PERMISSIONS + DISASTER-RECOVERY.

## Reprise (4 commandes)

```bash
cd D:\App\unifia\unifia-memory
git status --short && git branch --show-current
git log --oneline | head -5
cat docs/knowledge/execution/STATE.md | head -100
cat docs/knowledge/execution/FINAL-REPORT.md | head -40
```

## Cartes restantes (frontieres externes)

- P10.2 device run — Android device requis.
- P10.3 resource pressure — Android device requis.
- Phase Frontier review — modèle frontier externe.

## CLI subcommands (20)

```bash
unifia knowledge status | sources | search | doctor | bench | bench-large
unifia knowledge sovereignty [--vault=DIR] [--derived=PATH]
unifia knowledge disaster-recovery [--no-class-c] [--no-class-d] [--no-unifia] [--offline]
unifia knowledge migrate --dry-run|--rollback
unifia knowledge precommit install <ws>|scan <files...>
unifia knowledge portable <ws> list|upsert|remove|show
unifia knowledge reachability <ws>
unifia knowledge mcp-token issue|revoke|check|demo
unifia knowledge classify <ws>
unifia knowledge verify <ws> [--derived=PATH] [--online] [--cloud] [--device]
unifia knowledge policy <ws> show|set-egress|set-feature
unifia knowledge gc <ws> recommend|apply
unifia knowledge similarity <ws> [--topk=N]
unifia knowledge summary <ws> [--one-line]
unifia knowledge drill
```

## Test live

`unifia knowledge drill` :
  drill: 6/6 scenarios OK (0ms)
  PASS before-fsync                  INV-RECOVERY-PRE-FSYNC
  PASS after-fsync-before-rename     INV-RECOVERY-POST-FSYNC
  PASS after-rename-before-wal-fsync INV-RECOVERY-POST-RENAME
  PASS after-wal-fsync               INV-RECOVERY-POST-WAL
  PASS during-index-update           INV-RECOVERY-DURING-INDEX
  PASS during-wal-compaction         INV-RECOVERY-DURING-COMPACTION

`unifia knowledge summary tests/knowledge/eval/dev --one-line` :
  vault=...tests/knowledge/eval/dev  notes=12 (active=10)  parse-failures=1  class-B=0  policy.egress=absent
