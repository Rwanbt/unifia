<!-- SPDX-License-Identifier: MIT -->
# COMPACT — Sovereign Knowledge Core V1 (session compact view)

> Vue compacte pour reprise rapide après compaction de session.
> Voir `FINAL-REPORT.md` pour le détail et `STATE.md` pour
> l'append-only historique.

## One-liner

33 commits locaux, 360 tests passants, 13 phases couvertes
(55+ cartes, P10.2 + P10.3 = `NOT_EXECUTED_EXTERNAL_BOUNDARY`).

## SHA

- Branche : `feat/sovereign-knowledge-core`
- HEAD : `294e9f72b5`
- Initial : `95350647140a382ee6d5d61bc2f6639597d80f0b`

## Files at a glance

- Contrats : `packages/contracts/src/knowledge/` (10 fichiers).
- Runtime TS : `packages/unifia/src/knowledge/` (31 modules).
- Runtime Rust : `crates/unifia-knowledge-core/src/` (8 modules).
- CLI : `packages/unifia/bin/unifia-knowledge.ts` (15 subcommands).
- Tests : 360 passants (247 TS + 79 contracts + 34 Rust).
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

## CLI subcommands (15)

```bash
unifia knowledge status
unifia knowledge sources
unifia knowledge search "QUERY"
unifia knowledge doctor
unifia knowledge bench
unifia knowledge bench-large
unifia knowledge sovereignty [--vault=DIR] [--derived=PATH]
unifia knowledge disaster-recovery [--no-class-c] [--no-class-d] [--no-unifia] [--offline]
unifia knowledge migrate --dry-run|--rollback
unifia knowledge precommit install <ws>|scan <files...>
unifia knowledge portable <ws> list|upsert|remove|show
unifia knowledge reachability <ws>
unifia knowledge mcp-token issue|revoke|check|demo
unifia knowledge classify <ws>
```

## Tests count (cette session)

- 10 tests disaster-recovery
- 7 tests migration
- 6 tests sovereignty-runner
- 9 tests precommit
- 9 tests MCP token
- 5 tests reachability
- 10 tests portable store
- 5 tests corpus classify
- 10 tests audit log
- 4 tests cross-mode bus pipeline
- 3 tests cross-mode pipeline
- + 26 tests preexisting (parser, source, etc.)

Total: 360 verts (247 TS knowledge + 79 contracts + 34 Rust).
