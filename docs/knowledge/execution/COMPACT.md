<!-- SPDX-License-Identifier: MIT -->
# COMPACT — Sovereign Knowledge Core V1 (session compact view)

> Vue compacte pour reprise rapide après compaction de session.
> Voir `FINAL-REPORT.md` pour le détail et `STATE.md` pour
> l'append-only historique.

## One-liner

26 commits locaux, 317 tests passants, 13 phases couvertes
(50+ cartes, P10.2 + P10.3 = `NOT_EXECUTED_EXTERNAL_BOUNDARY`).

## SHA

- Branche : `feat/sovereign-knowledge-core`
- HEAD : à mettre à jour (session 2 en cours)
- Initial : `95350647140a382ee6d5d61bc2f6639597d80f0b`

## Files at a glance

- Contrats : `packages/contracts/src/knowledge/` (10 fichiers).
- Runtime TS : `packages/unifia/src/knowledge/` (25 modules).
- Runtime Rust : `crates/unifia-knowledge-core/src/` (8 modules).
- CLI : `packages/unifia/bin/unifia-knowledge.ts` (10 subcommands).
- Tests : 317 passants (204 TS + 79 contracts + 34 Rust).
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

## Cartes restantes (frontières externes)

- P10.2 device run — Android device requis.
- P10.3 resource pressure — Android device requis.
- Phase Frontier review — modèle frontier externe.

## Cartes durcissement V1 (session 2, livrées)

- P11.4 — Disaster Recovery Procedure (9 tests + doc)
- P11.5 — Migration dry-run + rollback (7 tests + CLI)
- P11.6 — Sovereignty Test Runner (6 tests + CLI)
- P8.1  — Git pre-commit scan hook (9 tests + CLI)
- P11.7 — Permissions / Egress documentation
- P7.3  — Real cross-mode E2E (3 tests)

## CLI subcommands

```bash
bun --cwd packages/unifia bin/unifia-knowledge.ts status
bun --cwd packages/unifia bin/unifia-knowledge.ts sources
bun --cwd packages/unifia bin/unifia-knowledge.ts search "QUERY"
bun --cwd packages/unifia bin/unifia-knowledge.ts doctor
bun --cwd packages/unifia bin/unifia-knowledge.ts bench
bun --cwd packages/unifia bin/unifia-knowledge.ts bench-large
bun --cwd packages/unifia bin/unifia-knowledge.ts sovereignty [--vault=DIR] [--derived=PATH]
bun --cwd packages/unifia bin/unifia-knowledge.ts disaster-recovery
bun --cwd packages/unifia bin/unifia-knowledge.ts migrate --dry-run
bun --cwd packages/unifia bin/unifia-knowledge.ts migrate --rollback
bun --cwd packages/unifia bin/unifia-knowledge.ts precommit install <workspace>
bun --cwd packages/unifia bin/unifia-knowledge.ts precommit scan <files...>
```
