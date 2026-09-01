<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# EXECUTION STATUS — UNIFIA AUTOMATE

> Statut : **PINNED**
> Phase : **PRE-0 — TERMINÉ**
> Date : 2026-09-01T16:00+02:00
> Format imposé par le plan §246 lignes 6140-6170.

---

## Current phase

`PRE-0` — Evidence Baseline. Trois livrables produits :
- `BASELINE.md` (30 003 octets) — repository, branch, HEAD, package inventory,
  dependency graph, architectures, commandes, suites, CI, branches, limites,
  dette, plateformes, preuves.
- `AUTOMATE_TRUST_PATH.md` (27 960 octets) — 14 surfaces classées
  `REQUIRED_UNCHANGED / REQUIRED_TO_MIGRATE / REQUIRED_TO_HARDEN / OUT_OF_PATH`.
- `RISK_REGISTER.md` (26 116 octets) — 14 findings, dont 2 `Critical`, 2 `High`,
  7 `NEEDS_EVIDENCE`, 3 `ALREADY_COVERED`, 1 `ACCEPT`, 2 `BASELINE_MISMATCH`.

---

## Current exact SHA

| Référence | Valeur |
|---|---|
| HEAD (commit) | `24b04998e2fd861711036501ad3f6e41a63f8c32` |
| HEAD (message) | `fix(e2e): the same impossible locators, in design-mode.spec.ts` |
| HEAD (auteur, date) | MM2-B02-WORKER, 2026-09-01 14:22:12 +02:00 |
| HEAD (tree) | **NON CALCULÉ** dans ce tour — à dériver via `git rev-parse HEAD^{tree}` dès qu'une gate l'exige |
| Branche de travail | `agent/automate-v2-baseline-20260901` |
| Branche d'origine | `integration/rev3m-20260901/design-automate` |
| Remote | `origin` = `https://github.com/Rwanbt/unifia.git` (push désactivé par la mission) |

---

## Completed cards

| Phase | Carte | Statut | Chemin |
|---|---|---|---|
| PRE-0 | `BASELINE.md` | **DONE** | `docs/automation-v2/BASELINE.md` |
| PRE-0 | `AUTOMATE_TRUST_PATH.md` | **DONE** | `docs/automation-v2/AUTOMATE_TRUST_PATH.md` |
| PRE-0 | `RISK_REGISTER.md` | **DONE** | `docs/automation-v2/RISK_REGISTER.md` |
| PRE-0 | `EXECUTION_STATUS.md` | **DONE** (ce document) | `docs/automation-v2/EXECUTION_STATUS.md` |
| PRE-0 | Branche de travail créée | **DONE** | `agent/automate-v2-baseline-20260901` |

---

## Open cards

| Phase | Carte | Statut | Pré-requis |
|---|---|---|---|
| PRE-0 | Décision utilisateur sur le sort du run (`GO_WITH_CONTAINED_DEBT` validé ou `NO_GO`) | **OPEN — bloquant externe** | réponse Erwan |
| PRE-0 (si NO_GO) | `BASELINE_BLOCKERS.md` puis `STOP-BASELINE` | **CONDITIONAL** | décision Erwan |
| PRE-0 (si GO) | Commit de pin (PRE-0) | **OPEN** | validation Erwan |
| PRE-1 | `PACKAGE_MIGRATION_MAP.md` | **OPEN** | PRE-0 = GO et commit pin |
| PRE-1 | `IMPLEMENTATION_CARD_INDEX.md` | **OPEN** | PACKAGE_MIGRATION_MAP |
| PRE-1 | Suite Automate minimale (carte bloquante R-013) | **OPEN — bloquant M1** | commit pin |
| PRE-1 | Cartographie Secret Broker (R-012) | **OPEN** | commit pin |
| ADR | ADR-000 (substrate) | **OPEN — bloquant M1** | R-013 résolu (suite minimale existe) |
| ADR | ADR-020 (ownership) | **OPEN** | ADR-000 |
| ADR | ADR-003 (expression) | **OPEN** | ADR-000 |
| ADR | ADR-002 (IR) | **OPEN** | ADR-003 |
| ADR | ADR-001 (canonicalisation) | **OPEN** | ADR-002 |
| ADR | ADR-004 (history authority) | **OPEN** | ADR-001 |
| ADR | ADR-005 (artifact contract) | **OPEN** | ADR-001 |
| ADR | ADR-010 (key/secret) | **OPEN** | ADR-004, ADR-005 |

---

## Green gates (mesurées ou rapportées)

| Gate | Statut | Source |
|---|---|---|
| `bun turbo typecheck --concurrency=1` | VERT 38/38 | SESSION-2 §7 |
| `bunx biome check packages/` | VERT 1 452 fichiers | SESSION-2 §7 |
| `cd packages/app && bun test --preload ./happydom.ts ./src` | VERT 1 175 pass, 0 fail | SESSION-2 §7 |
| Playwright `e2e/design` + `design-journey` | VERT 20/20 (3 runs consécutifs) | SESSION-2 §7 |
| Axe WCAG 2.1 AA 6 états | VERT hors `color-contrast` enregistré | SESSION-2 §3.3 |
| Modal d'approbation expiré navigateur | VERT 3 parcours | SESSION-2 §4 |
| Tauri build desktop + sidecar + sha256 | VERT | SESSION-2 §5 |
| `cli-process.test.ts` (CI=1, avec dist/) | VERT 11/11 | SESSION-2 §2 |
| `bun run test:knowledge` (Work) | VERT 892 pass, 1 skip, 0 fail | SESSION-2 §2 |
| Inventaire packages complet | 50 mesurés, 24/24 présents côté plan, 4 absents confirmés | `Get-ChildItem` |
| HEAD prouvé | `24b04998e2fd861711036501ad3f6e41a63f8c32` | `git rev-parse HEAD` |
| Working tree propre à l'inventaire | OK | `git status --porcelain` |
| Branche de travail créée depuis HEAD | OK | `git checkout -b` |

---

## Red gates (manquantes ou en attente)

| Gate | Statut | Source / Action |
|---|---|---|
| `e2e/automate` (suite Playwright Automate) | **ROUGE — finding R-013** | à créer en première carte PRE-1 |
| `automate-surface.test.ts` (unitaire) | **ROUGE — finding R-013** | idem |
| `WorkflowRuntime` substrate-grade | **ROUGE — finding R-014** | ADR-000 obligatoire |
| Tree-SHA HEAD | NON CALCULÉ | à dériver si gate l'exige |
| `bun turbo test:ci` sur la lignée complète (Work) | **NON RE-MESURÉ** après commit `33bea2ec04` | SESSION-2 §2 — R-009 |
| `e2e/app` + `e2e/modes` (régression complète) | 22/30, 8 failures réelles | SESSION-2 §7.1 — R-004, R-005, R-006 |
| Linux baselines visuelles | SKIP motivé (gate `design-visual` ne protège que win32) | SESSION-2 §3.2 — R-007 |
| `e2e/app/e2e` lint via biome | absent (R-008) | SESSION-2 §8 #7 |

---

## Accepted risks

| ID | Risque | Mitigation acceptée |
|---|---|---|
| R-002 | `color-contrast` global | documenté `a11y-debt`, exemption motivée par décision palette transverse |
| R-003 | `nested-interactive` chrome | idem |
| R-006 | switcher mobile Design | hors cible première (Automate Core × local-single-node) |
| R-007 | baselines Linux absentes | gate `design-visual` SKIP motivé sur Linux ; déterminisme tourne |
| R-010 | SHA prompt ≠ SHA réel | informationnel, préfixe 8-char matche, checkout vérifié sur le bon commit |
| R-011 | plan frontmatter SHA obsolète | informationnel, contenu normatif |

Ces risques ne violent aucune des 8 catégories interdites par le plan §237
(Critical, High, ambiguïté d'autorité, fuite de secret, isolation tenant,
contournement réseau, perte de clé, correction d'effet irréversible).

---

## New findings (PRE-0)

| ID | Severity | Description |
|---|---|---|
| R-001 | High | Correctif `09f1329a8d` `[arch-change]` non confirmé par l'utilisateur — voir `RISK_REGISTER.md` |
| R-004 | Medium | `titlebar-history.spec.ts` 3 occurrences, non diagnostiqué |
| R-005 | Medium | `mode-reload-stability.spec.ts`, fuite après 10 rechargements |
| R-008 | Medium | Biome ne lit pas `packages/app/e2e/**` |
| R-009 | Medium | Suite complète `packages/unifia` non relancée après commit Work `33bea2ec04` |
| R-012 | High | Aucun `@unifia/secret-broker` / `@unifia/key-authority` identifié comme package dédié |
| R-013 | **Critical** | `automate-surface.tsx` zéro test — 8 gates §16.3 sans preuve |
| R-014 | **Critical** | `WorkflowRuntime` actuel n'est pas un durable execution substrate |

---

## Architecture decisions

**Aucune décision d'architecture prise par cette session.** ADR-000 (substrate)
est la première carte ADR et n'a pas été entamée. La cartographie
(`AUTOMATE_TRUST_PATH.md`) trace les surfaces à durcir ou migrer, mais ne
 tranche pas.

**Décision de scope** : la cible première du plan est `Automate Core ×
local-single-node × first supported desktop platform` (plan §FIRST TARGET).
Cette cible est Windows ici. Les classes `OUT_OF_PATH` sont explicitement
listées dans `AUTOMATE_TRUST_PATH.md` §G.4.

**Décision de process** : PRE-0 s'arrête ici, sur le constat
`GO_WITH_CONTAINED_DEBT` sous 3 conditions explicites (R-001, R-013, R-014).
Aucun code durable de production n'est modifié, conformément à la consigne
« Ne modifie pas encore le durable kernel de production » du plan.

---

## Test results (PRE-0)

PRE-0 n'a pas lancé de test par lui-même — les tests sont rapportés depuis
SESSION-2-REPORT (machine, exécution vérifiée par l'auteur précédent) et
depuis les listings `Get-ChildItem` (présence / absence).

| Test | Statut rapporté | Source |
|---|---|---|
| typecheck turbo | 38/38 vert | SESSION-2 §7 |
| biome | 1 452 fichiers vert | SESSION-2 §7 |
| packages/app unit | 1 175 pass, 0 fail | SESSION-2 §7 |
| e2e/design + design-journey | 20/20 vert (3 runs) | SESSION-2 §7 |
| e2e/automate | **ABSENT** (finding R-013) | SESSION-2 §0 |
| workflow-runtime/test | présent, intégré `console.log` | listing |
| workbench-orchestrator/test | présent (test: bun test/orchestrator.test.ts) | `Get-Content package.json` |
| packages/unifia (suite complète) | 892/0/0 sur work; **NON RE-MESURÉ** après `33bea2ec04` (R-009) | SESSION-2 §2 |
| e2e/app + e2e/modes | 22/30 (8 failures) | SESSION-2 §7.1 |

---

## Next executable step

**Étapes immuables tant qu'Erwan n'a pas tranché** :

1. **Attente de décision utilisateur** sur la gate PRE-0 :
   - valider `GO_WITH_CONTAINED_DEBT` → commit de pin PRE-0 → démarrer PRE-1.
   - invalider → `BASELINE_BLOCKERS.md` → `STOP-BASELINE`.
2. **Si Erwan valide** : créer un commit de pin contenant
   `docs/automation-v2/{BASELINE.md, AUTOMATE_TRUST_PATH.md, RISK_REGISTER.md,
   EXECUTION_STATUS.md}` avec un message Conventional Commits de la forme
   `chore(automate-v2): pin PRE-0 evidence baseline at <sha>`. **Pas de
   push** (interdit par la mission).
3. **Démarrer PRE-1** par la première carte bloquante : la suite Automate
   minimale (R-013). C'est la carte qui doit exister avant tout ADR.

**Étapes parallèles possibles sans décision** (faible risque) :

- Lancer la cartographie `workbench-server/src/auth.ts` pour confirmer ou
  infirmer R-012 (Secret Broker). Lecture statique, pas de modification.
- Lancer la cartographie de `workflow-catalog/src/` pour confirmer R-014
  (taille réelle du package). Lecture statique.
- Diagnostiquer R-004, R-005, R-006 (e2e failures ouvertes). Tests à
  corriger, pas le code de production — ces tests sont dans
  `packages/app/e2e/**` et leur correction n'affecte pas le kernel.

**Ce qui n'est PAS exécuté sans validation** :

- Aucun commit n'a été créé pour PRE-0. Les 4 fichiers sont dans le
  working tree de la branche `agent/automate-v2-baseline-20260901`.
- Aucun push, aucun merge, aucun tag.
- Aucun fichier de code modifié.

---

## Annexe — fichiers de preuve créés par cette session

```
docs/automation-v2/
├── BASELINE.md               (30 003 octets, 1 commit à venir)
├── AUTOMATE_TRUST_PATH.md    (27 960 octets)
├── RISK_REGISTER.md          (26 116 octets)
├── EXECUTION_STATUS.md       (ce fichier)
└── certification/            (dossier créé, vide)
```

`git status --porcelain` après ces écritures :

```
?? docs/automation-v2/
```

Aucun fichier utilisateur en place n'a été modifié. La branche de travail
`agent/automate-v2-baseline-20260901` diverge de l'origine par **4
fichiers non suivis** (les 4 livrables PRE-0).
