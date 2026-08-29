<!-- SPDX-License-Identifier: MIT -->
# COMPACT — Sovereign Knowledge Core V1 (session compact view)

> Vue compacte pour reprise rapide après compaction de session.
> Voir `FINAL-REPORT.md` pour le détail et `STATE.md` pour
> l'append-only historique.

## One-liner

38 commits locaux, 387 tests passants, 13 phases couvertes
(63+ cartes, P10.2 + P10.3 = `NOT_EXECUTED_EXTERNAL_BOUNDARY`).

## SHA

- Branche : `feat/sovereign-knowledge-core`
- HEAD : `78af96a1c8`
- Initial : `95350647140a382ee6d5d61bc2f6639597d80f0b`

## Files at a glance

- Contrats : `packages/contracts/src/knowledge/` (10 fichiers).
- Runtime TS : `packages/unifia/src/knowledge/` (35 modules).
- Runtime Rust : `crates/unifia-knowledge-core/src/` (8 modules).
- CLI : `packages/unifia/bin/unifia-knowledge.ts` (18 subcommands).
- Tests : 387 passants (274 TS + 79 contracts + 34 Rust).
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

## CLI subcommands (18)

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
unifia knowledge verify <ws> [--derived=PATH] [--online] [--cloud] [--device]
unifia knowledge policy <ws> show|set-egress|set-feature
unifia knowledge gc <ws> recommend|apply
unifia knowledge similarity <ws> [--topk=N]
```

## Tests count (cette session 4)

Session 4 a ajouté 22 tests (total 274 TS + 79 contracts + 34 Rust = 387) :
- 10 tests portable store
- 5 tests reachability
- 9 tests MCP token
- 5 tests corpus classify
- 10 tests audit log
- 4 tests cross-mode bus pipeline
- 5 tests full verify
- 10 tests policy store
- 8 tests Class B GC
- 4 tests similarity simulation

## Test live sur vraies fixtures

`unifia knowledge verify tests/knowledge/eval/dev` :
  PASS sovereignty          5 probe(s); verdict=OK
  PASS disaster-recovery    3 step(s); simulation=OK
  PASS reachability         classA=12, classB=0
  PASS classify             parsed=11, failed=1, findings=0
verdict: OK  (total 26ms)

`unifia knowledge similarity tests/knowledge/eval/dev --topk=5` :
  emb-3 ~ emb-9  cosine=0.9179
  emb-0 ~ emb-7  cosine=0.9138
  emb-0 ~ emb-6  cosine=0.9083
  emb-6 ~ emb-7  cosine=0.8993
  emb-2 ~ emb-11 cosine=0.8993
