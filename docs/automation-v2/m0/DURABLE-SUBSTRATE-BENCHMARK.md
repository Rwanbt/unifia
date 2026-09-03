<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0 Durable Substrate Benchmark — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §20 (output obligatoire) + §22 (final comparison dimensions).

Document de synthèse comparative Native ↔ DBOS Go. **M0 ne peut
produire qu'un benchmark partiel** : DBOS Go est NOT EXECUTED
(Go toolchain absent, voir `WINDOWS_PREFLIGHT.md` §3 et
`adapters/dbos-go.ts` STUB).

## 1. Hard correctness (la base de la décision)

| FC | Description | UNIFIA_NATIVE | DBOS_GO_SQLITE |
|---|---|---|---|
| FC-31A | Canonical value round-trip (21 valeurs IEEE-754) | **PASS** 21/21 | NOT EXECUTED |
| FC-31B | host-integer vs host-float64 separation (13 vecteurs) | **PASS** 13/13 | NOT EXECUTED |
| FC-04 | Provider success + local ACK lost | **PASS** (UNKNOWN_EXTERNAL_STATE) | NOT EXECUTED |
| FC-14 | Second connection to same SQLite file (in-process) | **PASS** | NOT EXECUTED |
| FC-25 | Stale authority fencing (multi-process) | **BLOCKED** (single-process in M0) | NOT EXECUTED |
| FC-32 | Replay model declaration | **PASS** (NO) | NOT EXECUTED |
| FC-13 | Power-loss / storage fault | **NOT VALID** (no methodology in M0 env) | NOT EXECUTED |
| FC-13-CTRL | Power-loss negative control | **NOT VALID** | NOT EXECUTED |
| FC-01..FC-30 | Functional criteria (autres) | Non lancés en P0 (à exécuter en P1) | NOT EXECUTED |

**Compteur** : 4 PASS, 1 BLOCKED, 2 NOT VALID sur 7 P0 lancés.
DBOS Go : 0 / 7 (toolchain absent).

## 2. Outcome A / B / C (per pack gelé §21)

### Outcome A — UNIFIA_NATIVE

Conditions :
- Tous les REQUIRED gates PASS
- DBOS ne satisfait pas, ou Native est préféré après que les deux
  satisfassent correctness

Statut M0 : **partiellement vérifiable**. Les P0 PASS donnent une
**présomption favorable** mais ne sont pas la full matrix. La
**full matrix** (FC-01..FC-30, FC-13 avec méthodologie, etc.) doit
être exécutée pour conclure.

### Outcome B — DBOS_GO_SQLITE

Conditions :
- DBOS satisfait tous les REQUIRED gates
- DBOS gagne l'évaluation architecturale finale

Statut M0 : **non vérifiable**. DBOS Go n'a pas été exécuté (Go
absent). La présomption est neutre ; le go-language-elimination est
explicitement REJETÉ par le pack gelé.

### Outcome C — Aucun candidat ne satisfait

Conditions :
- Ni Native ni DBOS ne satisfont les REQUIRED gates
- ADR-000 reste OPEN

Statut M0 : **non concluant**. Le résultat M0 ne permet PAS de
trancher entre A et C : la full matrix n'a pas été exécutée, et DBOS
n'a pas été exécuté du tout.

## 3. Recommandation v1.1 review

**Pour Erwan** : ne pas ratifier maintenant. Compléter la full
matrix (P1+), débloquer l'environnement Go pour exécuter DBOS,
puis trancher A vs C avec preuves.

**Pour la prochaine session** :
1. P1 matrix sur Native (FC-01..FC-30, FC-13 power-loss avec VM,
   FC-25 multi-process réel)
2. DBOS Go dans environnement Go-équipé
3. Packaging + resources sur les deux
4. Exit strategies étoffées
5. Décision A/B/C

## 4. Cross-cutting dimensions (per pack gelé §22)

| Dimension | UNIFIA_NATIVE (mesuré) | DBOS_GO_SQLITE (estimé) |
|---|---|---|
| Operational simplicity | 1 process, Bun embedded | 2 processes, Go sidecar |
| Windows integration | OK (bun:sqlite / better-sqlite3) | Go cross-compile, musl |
| Packaging | ~30-60 MB binary (Node) | ~30-50 MB Go static |
| Startup | <300 ms | <1s |
| Memory | ~60-150 MB | ~50-200 MB |
| Disk | SQLite + WAL | SQLite + WAL |
| Upgrade | Node upgrade (frequent) | DBOS upstream |
| Backup | file copy + VACUUM | SQLite .backup API |
| Future mobile path | Faible (Bun/Node pas sur mobile) | Faible (Go mobile possible mais lourd) |
| Determinism burden | Aucun (imperative) | Élevé (workflow replay) |
| WorkflowIR constraints | Aucune (imperative) | Implicites (DBOS workflow model) |
| Maintained code surface | TS/Bun (~22 KB candidate + 30 KB harness) | TS + Go (~équivalent) |
| Dependency surface | bun:sqlite ou better-sqlite3 | TS + DBOS Go + SQLite driver |
| Security-response burden | Unifia uniquement | DBOS upstream |
| Forkability | MIT | MIT |
| Exit/migration difficulty | Modéré (export JSON Lines) | Modéré (DBOS API) |
| 5-year TCO | TBD | TBD |

## 5. Verdict M0

**Non concluant**. La sélection A vs C ne peut pas être tranchée
sans :
1. Full matrix sur Native
2. DBOS Go exécuté sur environnement Go-équipé
3. Cross-comparaison de toutes les dimensions du §22

Le rapport final `DURABLE-SUBSTRATE-BENCHMARK.md` sera produit
après ces exécutions. **Erwan ne doit pas ratifier maintenant**.

## 6. Source

- `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` §20, §21, §22
- `docs/automation-v2/m0/M0_RESULTS_UNIFIA_NATIVE.json`
- `docs/automation-v2/m0/M0_EXPECTED_NA_UNIFIA_NATIVE.json`
- `docs/automation-v2/m0/WINDOWS_PREFLIGHT.md`
- `docs/automation-v2/m0/PACKAGING_RESULTS.md`
- `docs/automation-v2/m0/EXIT_NATIVE.md`
- `docs/automation-v2/m0/EXIT_DBOS_GO.md`
