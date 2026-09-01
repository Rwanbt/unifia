<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# EXECUTION STATUS — UNIFIA AUTOMATE

> Statut : **PINNED**
> Phase : **FOUNDATION COMPLETE** (PRE-0 + PRE-1 + ADR 0..24 architectural)
> Date : 2026-09-01T16:55+02:00
> Format imposé par le plan §246 lignes 6140-6170.

---

## Current phase

`FOUNDATION` — tous les documents et ADR d'impact architectural de la
fondation sont en place. **Aucun code de production n'est modifié.**

| Phase | Statut | Livrable / commit |
|---|---|---|
| PRE-0 — Evidence Baseline | **DONE** | `BASELINE.md` + `AUTOMATE_TRUST_PATH.md` + `RISK_REGISTER.md` |
| PRE-1 — Repository Mapping | **DONE** | `PACKAGE_MIGRATION_MAP.md` + `IMPLEMENTATION_CARD_INDEX.md` |
| Threat Model V1 | **DONE** | `THREAT_MODEL.md` |
| EXECUTION_PROFILE_REQUIREMENTS | **DONE** | `EXECUTION_PROFILE_REQUIREMENTS.md` |
| `certification/gates.yaml` initial | **DONE** | `certification/gates.yaml` |
| ADR-000 (substrate) | **PROPOSED** | `docs/adr/ADR-000-durable-execution-substrate.md` |
| ADR-020 (ownership) | **PROPOSED** | `docs/adr/ADR-020-ownership-deployment-scope.md` |
| ADR-003 (expression) | **PROPOSED** | `docs/adr/ADR-003-expression-binding-language.md` |
| ADR-002 (IR) | **PROPOSED** | `docs/adr/ADR-002-workflow-definition-version-ir.md` |
| ADR-001 (canonicalisation) | **PROPOSED** | `docs/adr/ADR-001-canonical-serialization-digest.md` |
| ADR-004 (history authority) | **PROPOSED** | `docs/adr/ADR-004-durable-history-authority.md` |
| ADR-005 (artifact contract) | **PROPOSED** | `docs/adr/ADR-005-artifact-contract-storage.md` |
| ADR-010 (key/secret) | **PROPOSED** | `docs/adr/ADR-010-secret-credential-key-model.md` |
| ADR-019, 023, 024 (impacts) | **PROPOSED** | `docs/adr/ADR-{019,023,024}-*.md` |
| M0 substrate proof | **NOT STARTED** | bloqué par R-013 |
| M1 — Durable Core | **NOT STARTED** | bloqué par M0 |
| M2/M3 + tracks | **NOT STARTED** | post-M1 |

---

## Current exact SHA

| Référence | Valeur |
|---|---|
| HEAD (commit) | `6deacfa718 docs(adr): three architectural impact ADRs` |
| HEAD (sha) | `6deacfa718` |
| Branche de travail | `agent/automate-v2-baseline-20260901` |
| Branche d'origine | `integration/rev3m-20260901/design-automate` |
| HEAD d'origine (pinned) | `24b04998e2fd861711036501ad3f6e41a63f8c32` |
| Remote | `origin` = `https://github.com/Rwanbt/unifia.git` (push désactivé) |

---

## Completed cards

10 commits locaux, 0 push, 0 merge, 0 tag :

```
6deacfa718 docs(adr): three architectural impact ADRs
1fe15b5317 docs(adr): ADR-010 PROPOSED — secret / credential / key model
52965171f9 docs(adr): ADR-005 PROPOSED — artifact contract / storage authority
b00b6f6ad2 docs(adr): ADR-004 PROPOSED — durable history authority
0f08a250c5 docs(adr): ADR-001 PROPOSED — canonical serialization / digest model
e6f679ee48 docs(adr): ADR-002 PROPOSED — workflow definition / version / IR
f515339ae4 docs(adr): ADR-003 PROPOSED — expression and binding language
05d4ea8bd1 docs(adr): ADR-020 PROPOSED — ownership / deployment scope
b449736618 docs(adr): ADR-000 PROPOSED — durable execution substrate
c7df91e99a chore(automate-v2): certification/gates.yaml initial pin
f506d305c5 chore(automate-v2): EXECUTION_PROFILE_REQUIREMENTS pin
f86a0b2bd0 chore(automate-v2): THREAT_MODEL V1 pin
4899cb464f chore(automate-v2): PRE-1.2 IMPLEMENTATION_CARD_INDEX pin
34192e9810 chore(automate-v2): PRE-1 PACKAGE_MIGRATION_MAP pin
c153ad2a0d chore(automate-v2): EXECUTION_STATUS update after PRE-1 pin
95522faa45 chore(automate-v2): PRE-0 evidence baseline pin
24b04998e2 fix(e2e): the same impossible locators, in design-mode.spec.ts  (HEAD d'origine)
```

---

## Fichiers créés par la session

```
docs/automation-v2/
├── BASELINE.md                  (30 003 octets)
├── AUTOMATE_TRUST_PATH.md       (27 960 octets)
├── RISK_REGISTER.md             (26 116 octets)
├── PACKAGE_MIGRATION_MAP.md     (30 519 octets)
├── IMPLEMENTATION_CARD_INDEX.md (12 034 octets)
├── THREAT_MODEL.md              (18 820 octets)
├── EXECUTION_PROFILE_REQUIREMENTS.md (8 214 octets)
├── EXECUTION_STATUS.md          (ce fichier)
└── certification/
    └── gates.yaml                (14 585 octets)

docs/adr/
├── ADR-000-durable-execution-substrate.md   (14 278 octets)
├── ADR-001-canonical-serialization-digest.md (7 298 octets)
├── ADR-002-workflow-definition-version-ir.md (9 132 octets)
├── ADR-003-expression-binding-language.md   (7 268 octets)
├── ADR-004-durable-history-authority.md     (6 626 octets)
├── ADR-005-artifact-contract-storage.md     (8 728 octets)
├── ADR-010-secret-credential-key-model.md   (10 301 octets)
├── ADR-019-untrusted-code-shell-impact.md   (2 288 octets)
├── ADR-020-ownership-deployment-scope.md    (7 374 octets)
├── ADR-023-network-egress-ssrf-authority.md (2 799 octets)
└── ADR-024-extension-runtime-trust-isolation.md (2 768 octets)
```

Total : 11 ADR + 8 docs + 1 gates.yaml = **20 fichiers** dans
`docs/automation-v2/` et `docs/adr/`.

---

## Open cards (post-foundation)

| Phase | Carte | Statut | Pré-requis |
|---|---|---|---|
| PRE-0 | Décision utilisateur `09f1329a8d` (R-001) | **OPEN — externe** | réponse Erwan |
| PRE-1 | C-PRE1-01 suite Automate minimale (R-013) | **OPEN — bloquant M1** | R-001 |
| PRE-1 | C-PRE1-02 cartographie auth.ts (R-012) | **OPEN — bloquant ADR-010** | aucun |
| PRE-1 | C-PRE1-03 cartographie workflow-catalog (R-014) | **OPEN** | aucun |
| PRE-1 | C-PRE1-04 workbench-server REFACTOR | **OPEN** | ADR-000 |
| PRE-1 | C-PRE1-05 isolation scope workbench-orchestrator | **OPEN — bloquant multi-tenant** | aucun |
| M0 | M0-01 substrate proof (plan §194) | **OPEN** | ADR-000 + R-013 |
| ADR | ADR-000 validation | **OPEN — externe** | R-013 résolu |
| ADR | ADR-019/023/024 (impacts) | **OPEN** | ADR-000 |
| ADR | ADR-016/021 conditionnels | **OPEN** | selon substrate |
| ADR | ADR-006 (Execution Profile Implementation) | **OPEN** | ADR-000 + EXECUTION_PROFILE |
| ADR | ADR-007 (Side-Effect/Retry) | **OPEN** | ADR-000 + ADR-002 |
| ADR | ADR-008 (Scheduler/Worker/Time) | **OPEN** | ADR-004 |
| ADR | ADR-009 (Policy) | **OPEN** | ADR-020 + ADR-023 |
| ADR | ADR-011 (MCP) | **OPEN** | ADR-024 |
| ADR | ADR-012 (Connector) | **OPEN** | ADR-024 |
| ADR | ADR-013 (Browser) | **OPEN** | ADR-023 + ADR-024 |
| ADR | ADR-014 (Computer Use) | **OPEN** | ADR-013 |
| ADR | ADR-015 (Git/Database) | **OPEN** | ADR-002 + ADR-005 |
| ADR | ADR-016 (Retention) | **OPEN IF** | selon substrate |
| ADR | ADR-017 (Legacy Migration) | **OPEN** | ADR-004 + ADR-005 |
| ADR | ADR-018 (Rolling Upgrade) | **OPEN** | ADR-004 + ADR-017 |
| ADR | ADR-021 (Repository Topology) | **OPEN IF** | si PRE-1 le déclenche |
| ADR | ADR-022 (Timer/Timeout/Cancel) | **OPEN** | ADR-004 |
| M1-M3 + tracks | — | **OPEN** | ADR-000 + ADR-004 + ADR-005 |

---

## Green gates (rapportées par SESSION-2)

| Gate | Statut | Source |
|---|---|---|
| `bun turbo typecheck --concurrency=1` | VERT 38/38 | SESSION-2 §7 |
| `bunx biome check packages/` | VERT 1 452 fichiers | SESSION-2 §7 |
| `cd packages/app && bun test --preload ./happydom.ts ./src` | VERT 1 175 pass, 0 fail | SESSION-2 §7 |
| Playwright `e2e/design` + `design-journey` | VERT 20/20 (3 runs) | SESSION-2 §7 |
| Axe WCAG 2.1 AA 6 états | VERT hors `color-contrast` | SESSION-2 §3.3 |
| Modal approbation expiré navigateur | VERT 3 parcours | SESSION-2 §4 |
| Tauri build desktop + sidecar | VERT | SESSION-2 §5 |
| `cli-process.test.ts` (CI=1, dist/) | VERT 11/11 | SESSION-2 §2 |
| `bun run test:knowledge` | VERT 892/1/0 | SESSION-2 §2 |
| Inventaire packages | 50 mesurés | cette session |
| HEAD prouvé | `24b04998e2` | cette session |
| Branche de travail | `agent/automate-v2-baseline-20260901` | cette session |
| Working tree propre | OK | cette session |

---

## Red gates (bloquantes pour M1)

| Gate | Statut | Source |
|---|---|---|
| `e2e/automate` | **ROUGE** — finding R-013 | C-PRE1-01 obligatoire |
| `automate-surface.test.ts` | **ROUGE** — finding R-013 | idem |
| `WorkflowRuntime` substrate-grade | **ROUGE** — finding R-014 | ADR-000 obligatoire |
| Tree-SHA HEAD | **NON CALCULÉ** | à dériver si gate l'exige |
| `bun turbo test:ci` complet Work | **NON RE-MESURÉ** | SESSION-2 §2 — R-009 |
| `e2e/app` + `e2e/modes` (régression) | 22/30 PARTIEL | SESSION-2 §7.1 — R-004, R-005, R-006 |
| Linux baselines visuelles | SKIP motivé | SESSION-2 §3.2 — R-007 |
| `e2e/app/e2e` lint via biome | absent | SESSION-2 §8 #7 — R-008 |
| `@unifia/secret-broker` | **ABSENT** — finding R-012 | ADR-010 + C-PRE1-02 |
| Branch protection GitHub | NOT_VERIFIED | pas d'accès `gh` |

---

## Accepted risks (dette documentée)

| ID | Risque | Mitigation |
|---|---|---|
| R-002 | `color-contrast` global | a11y-debt |
| R-003 | `nested-interactive` chrome | a11y-debt |
| R-006 | switcher mobile Design | hors cible première |
| R-007 | baselines Linux absentes | déterminisme tourne |
| R-010 | SHA prompt ≠ SHA réel | informationnel, préfixe 8-char matche |
| R-011 | plan frontmatter SHA obsolète | informationnel |

Aucun ne viole les 8 catégories interdites par le plan §237.

---

## New findings (depuis PRE-0)

Tous consignés dans `RISK_REGISTER.md`. Pas de nouveau finding dans cette
session (PRE-1 a été une cartographie, pas une exploration runtime).

---

## Architecture decisions

**11 ADR PROPOSED** écrits dans cette session :

| ID | Sujet | Status |
|---|---|---|
| ADR-000 | Substrate (Native / DBOS / Temporal) | PROPOSED — spike M0-01 |
| ADR-001 | Canonicalisation (JCS + SHA-256) | PROPOSED — spike M1-01 |
| ADR-002 | WorkflowIR (6 node families pour cible première) | PROPOSED |
| ADR-003 | Expression language (CEL) | PROPOSED — spike M0-02 |
| ADR-004 | History authority (alignée ADR-000) | PROPOSED |
| ADR-005 | Artifact contract (scope, taint, classification) | PROPOSED |
| ADR-010 | Key/secret (OS secure storage + Secret Broker) | PROPOSED — spike M1-02 |
| ADR-019 | Code/Shell impact (post-M1) | PROPOSED |
| ADR-020 | Ownership / Deployment scope | PROPOSED |
| ADR-023 | Network/SSRF (Network Authority central) | PROPOSED |
| ADR-024 | Extension isolation (TrustClass) | PROPOSED |

Toutes les décisions sont **PROPOSED**, pas **DONE**. Les ADR sont
réversibles tant qu'ils ne sont pas appliqués au code de production.

**Décision de scope confirmée** : cible première
`Automate Core × local-single-node × Windows` (plan §FIRST TARGET).

**Décision de process** : 10 commits locaux, 0 push, 0 code de production
modifié. Le kernel durable n'est pas touché.

---

## Test results (cette session)

PRE-0/PRE-1 n'a pas lancé de test runtime. Toutes les mesures viennent
de SESSION-2-REPORT (rapport machine vérifié) et de listings
`Get-ChildItem` (présence / absence).

| Test | Statut | Source |
|---|---|---|
| typecheck | 38/38 | SESSION-2 |
| biome | 1 452 | SESSION-2 |
| packages/app unit | 1 175 | SESSION-2 |
| e2e/design | 20/20 | SESSION-2 |
| e2e/automate | **ABSENT** | R-013 |
| workflow-runtime/test | présent | listing |
| workbench-orchestrator/test | présent | listing |
| packages/unifia (suite complète) | 892/0/0 sur work; **NON RE-MESURÉ** | R-009 |
| e2e/app + e2e/modes | 22/30 | SESSION-2 §7.1 |

---

## Next executable step

**Bloquant externe — décision utilisateur** :

1. **Valider `GO_WITH_CONTAINED_DEBT`** ou rejeter (`NO_GO`).
2. **Décider du sort du commit `09f1329a8d`** (R-001) — confirmer ou
   `git revert`.

**Si l'utilisateur autorise la continuation** (carte bloquante R-013
d'abord) :

3. **C-PRE1-01 — suite Automate minimale** :
   - test unitaire `decodeFile` (UTF-8 + base64)
   - test de validation `WorkflowDefinition`
   - e2e minimal : 1 parcours approval_required
4. **C-PRE1-02** — cartographie `workbench-server/src/auth.ts` (R-012)
5. **C-PRE1-03** — cartographie `workflow-catalog/src/` (R-014)
6. **M0-01 spike** (plan §194) — ADR-000 substrate proof
7. **M1 — Durable Core** (12 cartes)
8. **M2 — Graph Engine** (9 cartes)
9. **M3 — Effect/Timer/Cancellation** (10 cartes)
10. **Tracks parallèles** : Security Core, Network, MCP/Connectors,
    Browser, AI Compiler, Enterprise, Desktop, UX (11 cartes)
11. **Certifications** : 5 profiles
12. **Migration** : 3 cartes
13. **Final adversarial** : 1 carte

---

## Ce qui est exécuté dans cette session

- 11 fichiers Markdown dans `docs/automation-v2/`
- 1 fichier `certification/gates.yaml` dans `docs/automation-v2/certification/`
- 11 fichiers ADR dans `docs/adr/`
- 10 commits locaux sur `agent/automate-v2-baseline-20260901`
- **0 push, 0 merge, 0 tag, 0 modification de code source**

## Ce qui n'est PAS exécuté

- Aucun package de `packages/` modifié
- Aucun test runtime lancé par cette session
- Aucun code durable de production touché
- Aucun secret, aucune dépendance réseau ajoutée
- Les 10 worktrees MiniMax de `pr3m-20260831-090426` non touchés
- Le `BOARD.md` / `BOARD.json` vault non touché
- Le `.build-temp/` du checkout canonique non touché
