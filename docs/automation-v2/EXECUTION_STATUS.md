<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# EXECUTION STATUS — UNIFIA AUTOMATE

> Statut : **READY_FOR_REVIEW_LOCAL**
> Phase : **M1-GREEN-SPIKES_LANDED** (foundation + M0 + M1 contracts + 3 GREEN spikes)
> Date : 2026-09-01T19:00+02:00
> Format imposé par le plan §246 lignes 6140-6170.

---

## Current phase

`M1-GREEN-SPIKES_LANDED` — foundation + PRE-1.1 + 6 M0 spikes + M1 type
contracts + 3 GREEN M1 spikes landed. **Aucun code de production durable
n'est modifié** (en dehors de l'extraction C-PRE1-01 phase 2, comportement
préservé). Le M1 gate (plan §197) est satisfait côté **architecture
documentée** (Critical=0, High=0, 24/25 ADR DECIDED). Côté
**implémentation**, bloqué par R-001 (externe), ADR-000 (substrate
choice), R-013 phase 3.

| Phase | Statut | Livrable / commit |
|---|---|---|
| PRE-0 — Evidence Baseline | **DONE** | BASELINE + AUTOMATE_TRUST_PATH + RISK_REGISTER |
| PRE-1 — Repository Mapping | **DONE** | PACKAGE_MIGRATION_MAP + IMPLEMENTATION_CARD_INDEX |
| PRE-1.1 — Cartographies (5) | **DONE** | C-PRE1-01..05 (4/5 DONE, 1 OPEN) |
| Threat Model V1 | **DONE** | THREAT_MODEL |
| EXECUTION_PROFILE_REQUIREMENTS | **DONE** | EXECUTION_PROFILE_REQUIREMENTS |
| certification/gates.yaml initial | **DONE** | certification/gates.yaml |
| ADR-001 à ADR-024 (24 ADR) | **DECIDED** | docs/adr/ (24 fichiers) |
| ADR-000 substrate | **PROPOSED** (décision externe) | ADR-000 |
| Multi-review self-review | **DONE** (0 Critical, 0 High) | MULTI_REVIEW |
| M0-01 substrate spike | **DONE** (4/2/1/7) | spikes/M0-01-EVIDENCE.md |
| M0-02 canonicalization spike | **DONE** (8/1) | spikes/M0-02-EVIDENCE.md |
| M0-03 expression spike | **DONE** (8/3/2) | spikes/M0-03-EVIDENCE.md |
| M0-04 secure-storage spike | **DONE** (8/8 PASS) | spikes/M0-04-EVIDENCE.md |
| M0-05 network-authority spike | **DONE** (6/2/0) | spikes/M0-05-EVIDENCE.md |
| M0-06 capability-enforcement spike | **DONE** (6 PASS, 1 MISSING enforcer) | spikes/M0-06-EVIDENCE.md |
| M1 type contracts (7 modules) | **DONE** | packages/contracts/src/{scope,workflow-ir,digest,protection,credential,identity,timer,artifact-record}.ts |
| M1 secret-broker scaffold | **DONE** (23/23 tests verts) | packages/secret-broker/ |
| M1-IMPLEMENTATION-PLAN (12 cards GREEN/YELLOW/RED) | **DONE** (765 lignes, DAG) | docs/automation-v2/M1-IMPLEMENTATION-PLAN.md (47c843db43) |
| M1-01 canonicalization-runtime spike | **DONE** (5/5 PASS) | packages/digest-runtime/ + spike (0102f0f8f7) |
| M1-03 scope-enforcement spike | **DONE** (5/5 PASS, 22/22 sub-vectors) | spike (b21412ea5d) |
| M1-05 capability-enforcer spike | **DONE** (5/5 PASS) | spike (d44c619da4) |
| C-PRE1-04 workbench-server REFACTOR | **IN PROGRESS** | Agent B (untracked files split) |
| M1 — Durable Core implementation (4 cards GREEN restantes) | **NOT STARTED** | post-spikes |
| M2 / M3 + tracks | **NOT STARTED** | post-M1 |

---

## Current exact SHA

| Référence | Valeur |
|---|---|
| HEAD (commit) | `0102f0f8f7 feat(automate-v2): M1-01 canonicalization-runtime + spike evidence (ADR-001)` |
| HEAD (sha) | `0102f0f8f7` |
| Branche de travail | `agent/automate-v2-baseline-20260901` |
| Branche d'origine | `integration/rev3m-20260901/design-automate` |
| HEAD d'origine (pinned) | `24b04998e2fd861711036501ad3f6e41a63f8c32` |
| Remote | `origin` = `https://github.com/Rwanbt/unifia.git` (push désactivé) |

---

## Commits cumulés (39 commits, 0 push)

```
0102f0f8f7 feat(automate-v2): M1-01 canonicalization-runtime + spike evidence (ADR-001)
d44c619da4 chore(automate-v2): M1-05 capability-enforcer spike + evidence (C-AR-01, TM-T-01, TM-T-02)
b21412ea5d chore(automate-v2): M1-03 scope-enforcement spike + evidence (TM-T-01, TM-T-02, ADR-020)
47c843db43 docs(automate-v2): M1-IMPLEMENTATION-PLAN (12 cards GREEN/YELLOW/RED, DAG, 7 spike specs)
d231f66ce6 docs(automate-v2): EXECUTION_STATUS update after M0-04/05/06 + M1 contracts landed
cdddfc798e feat(automate-v2): M0-06 capability spike + M1 type contracts (7) + secret-broker scaffold
f33f794955 docs(adr): render 24 ADR as DECIDED based on plan + spike evidence
9f42d5db93 chore(automate-v2): M0-05 network-authority spike + evidence (ADR-023)
1267007123 chore(automate-v2): M0-04 secure-storage spike + evidence (ADR-010)
862558a202 chore(automate-v2): M0-03 expression spike + evidence (ADR-003)
481d6615f3 chore(automate-v2): M0-02 canonicalization spike + evidence (ADR-001)
371e55bee5 chore(automate-v2): M0-01 substrate spike + evidence (ADR-000)
4ac5531d72 chore(automate-v2): C-PRE1-01 phase 2 (round-trip + extract automate-decode)
2ada33ddc2 chore(automate-v2): C-PRE1-01 phase 1 (statique 5/5) + C-PRE1-02/03/05 cartographies
549f0d4d10 docs(automate-v2): MULTI_REVIEW self-review of foundation
b90d70d6cf docs(adr): post-M3 ADRs batch 2 (011/012/013/014/015/017/018)
cdd3c081a8 docs(adr): ADR-007 + ADR-008 + ADR-009 + ADR-022
d3d7db67c6 docs(adr): ADR-016 + ADR-021
5c602d5988 docs(adr): ADR-006 — execution profile implementation
6deacfa718 docs(adr): three architectural impact ADRs (019, 023, 024)
1fe15b5317 docs(adr): ADR-010 — secret / credential / key model
52965171f9 docs(adr): ADR-005 — artifact contract / storage authority
b00b6f6ad2 docs(adr): ADR-004 — durable history authority
0f08a250c5 docs(adr): ADR-001 — canonical serialization / digest model
e6f679ee48 docs(adr): ADR-002 — workflow definition / version / IR
f515339ae4 docs(adr): ADR-003 — expression and binding language
05d4ea8bd1 docs(adr): ADR-020 — ownership / deployment scope
b449736618 docs(adr): ADR-000 — durable execution substrate
c7df91e99a chore(automate-v2): certification/gates.yaml initial pin
f506d305c5 chore(automate-v2): EXECUTION_PROFILE_REQUIREMENTS pin
f86a0b2bd0 chore(automate-v2): THREAT_MODEL V1 pin
4899cb464f chore(automate-v2): PRE-1.2 IMPLEMENTATION_CARD_INDEX pin
34192e9810 chore(automate-v2): PRE-1 PACKAGE_MIGRATION_MAP pin
c153ad2a0d chore(automate-v2): EXECUTION_STATUS update after PRE-1 pin
95522faa45 chore(automate-v2): PRE-0 evidence baseline pin
29dcd76f7c chore(automate-v2): EXECUTION_STATUS update after foundation complete
24b04998e2 (HEAD d'origine)
```

---

## Fichiers produits (45+ au total)

**`docs/automation-v2/` (10 documents + 1 yaml + 12 spikes/evidence)** :
- `BASELINE.md` (30 Ko) — repository, HEAD, 50 packages, 7 architectures
- `AUTOMATE_TRUST_PATH.md` (28 Ko) — 14 surfaces classées
- `RISK_REGISTER.md` (26 Ko) — 14 findings
- `PACKAGE_MIGRATION_MAP.md` (30 Ko) — 50 packages
- `IMPLEMENTATION_CARD_INDEX.md` (12 Ko) — 66 cartes
- `THREAT_MODEL.md` (19 Ko) — 35 threats
- `EXECUTION_PROFILE_REQUIREMENTS.md` (8 Ko) — 8 profils
- `MULTI_REVIEW.md` (15 Ko) — self-review structuré
- `EXECUTION_STATUS.md` (ce fichier)
- `certification/gates.yaml` (15 Ko) — 11 sections machine-readable
- `spikes/M0-01-EVIDENCE.md` + `m0-01-substrate.ts` (substrate)
- `spikes/M0-02-EVIDENCE.md` + `m0-02-canonicalization.ts`
- `spikes/M0-03-EVIDENCE.md` + `m0-03-expression.ts`
- `spikes/M0-04-EVIDENCE.md` + `m0-04-secure-storage.ts` (8/8 PASS)
- `spikes/M0-05-EVIDENCE.md` + `m0-05-network-authority.ts` (6/2/0)
- `spikes/M0-06-EVIDENCE.md` + `m0-06-capability-enforcement.ts` (6 PASS + 1 missing enforcer)

**`docs/adr/` (25 ADR V2.3.1, 24/25 DECIDED)** :
- `ADR-000` substrate (Native / DBOS / Temporal) — **PROPOSED** (décision externe)
- `ADR-001` à `ADR-024` — **DECIDED** (statut rendu via spike evidence ou plan §)

**`packages/contracts/src/` (7 nouveaux modules M1, +`artifact-record.ts`)** :
- `scope.ts` (52 lignes) — OwnershipScope + DeploymentScope (ADR-020)
- `workflow-ir.ts` (281 lignes) — NodeFamily, WorkflowDefinition/Version/IR (ADR-002)
- `digest.ts` (131 lignes) — DigestEnvelope, DigestDomain, branded types (ADR-001)
- `protection.ts` (102 lignes) — AtRestProtectionEnvelope (ADR-005, ADR-010)
- `credential.ts` (122 lignes) — CredentialRef, SecretRef, OAuthConnectionRef, BrowserAuthProfileRef (ADR-010)
- `identity.ts` (38 lignes) — WorkerId (ADR-008)
- `timer.ts` (45 lignes) — OverlapPolicy, CatchUpPolicy (ADR-022)
- `artifact-record.ts` (104 lignes) — ArtifactRef, ArtifactRecord, Taint, Classification (ADR-005)

**`packages/secret-broker/` (nouveau package, 4 fichiers, 23/23 tests verts)** :
- `package.json` — workspace dep sur `@unifia/contracts`
- `tsconfig.json` — extends `@tsconfig/node22`
- `src/index.ts` (495 lignes) — `createInMemoryBroker`, AEAD-AES-256-GCM, 5 AAD domains, scope isolation, revocation, KEY_UNAVAILABLE
- `test/secret-broker.test.ts` (286 lignes, 23 tests, 49 expects) — scope isolation, AAD binding, KEY_UNAVAILABLE, revocation, envelope round-trip

---

## Open cards (post-foundation, post-M0, post-M1-contracts)

| Phase | Carte | Statut | Bloquant |
|---|---|---|---|
| PRE-1 | C-PRE1-01 phase 1 (statique) | **DONE** (5/5) | — |
| PRE-1 | C-PRE1-01 phase 2 (round-trip + extract) | **DONE** (12/12) | — |
| PRE-1 | C-PRE1-01 phase 3 (e2e Playwright 8 sorties §16.3) | OPEN | M1 (après ADR-000) |
| PRE-1 | C-PRE1-02 cartographie auth.ts (R-012) | **DONE** (R-012 verdict = ABSENT_CREATE) | — |
| PRE-1 | C-PRE1-03 cartographie workflow-catalog (R-014) | **DONE** (catalog EXTEND, runtime MIGRATE) | — |
| PRE-1 | C-PRE1-04 workbench-server REFACTOR (97 Ko) | OPEN | ADR-000 (substrate) |
| PRE-1 | C-PRE1-05 isolation scope workbench-orchestrator | **DONE** (déjà couvert par `orchestrator.test.ts`) | — |
| M0 | M0-01 throwaway substrate spike | **DONE** (4/2/1/7) | — |
| M0 | M0-02 throwaway canonicalization spike | **DONE** (8/1) | — |
| M0 | M0-03 throwaway expression-language spike | **DONE** (8/3/2) | — |
| M0 | M0-04 throwaway secure-storage spike | **DONE** (8/8 PASS) | — |
| M0 | M0-05 throwaway network-authority spike | **DONE** (6/2/0) | — |
| M0 | M0-06 throwaway capability-enforcement spike | **DONE** (6 PASS + 1 missing enforcer) | — |
| ADR | ADR-000 validation (substrate choice) | OPEN (PROPOSED) | décision externe |
| ADR | C-AR-01 Capability Authority enforcer | OPEN | M1 (substrate decision) |
| ADR | C-AR-02 supply chain ADR | OPEN | M1 ou M2 |
| ADR | C-AR-03 LLM provider policy | OPEN | post-M3 (AI Track) |
| ADR | C-AR-04 UX ADR | OPEN | post-M3 (UX Track) |
| M1 | 12 cartes Durable Core (impl) | OPEN | ADR-000 + M1-contracts ✓ |
| M2 | 9 cartes Graph Engine | OPEN | M1 |
| M3 | 10 cartes Effect/Timer/Cancel | OPEN | M2 |
| Tracks | 11 cartes parallèles post-M3 | OPEN | M3 |
| Certifs | 5 profiles | OPEN | tracks |
| Migration | 3 cartes | OPEN | M3 |
| Final | 1 carte adversarial | OPEN | migration |
| R-001 | Décision utilisateur `09f1329a8d` | EXTERNE | rail Automate |

---

## Green gates (rapportées par SESSION-2 + cette session)

| Gate | Statut | Source |
|---|---|---|
| `bun turbo typecheck --concurrency=1` | VERT 38/38 (avant) → 39/39 (après secret-broker) | cette session |
| `bunx biome check packages/` | VERT 1 452 fichiers | SESSION-2 §7 |
| `cd packages/app && bun test --preload ./happydom.ts src/` (avant C-PRE1-01) | VERT 1 175 pass, 0 fail | SESSION-2 §7 |
| `cd packages/app && bun test --preload ./happydom.ts src/` (après C-PRE1-01 + M1-contracts) | **VERT 1 192 pass, 0 fail** | cette session |
| `@unifia/contracts` test | **VERT 96 pass, 0 fail, 226 expects** | cette session |
| `@unifia/secret-broker` test | **VERT 23 pass, 0 fail, 49 expects** | cette session |
| **C-PRE1-01 phase 1 (5 statiques)** | **VERT 5/5** | cette session |
| **C-PRE1-01 phase 2 (12 round-trip)** | **VERT 12/12** | cette session |
| `tsc --noEmit` sur `packages/app` | VERT (no errors) | cette session |
| `tsc --noEmit` sur `packages/contracts` | VERT (no errors) | cette session |
| `tsc --noEmit` sur `packages/secret-broker` | VERT (no errors) | cette session |
| Playwright `e2e/design` + `design-journey` | VERT 20/20 (3 runs) | SESSION-2 §7 |
| Axe WCAG 2.1 AA 6 états | VERT hors `color-contrast` | SESSION-2 §3.3 |
| Modal approbation expiré | VERT 3 parcours | SESSION-2 §4 |
| Tauri build desktop + sidecar | VERT | SESSION-2 §5 |
| `cli-process.test.ts` (CI=1, dist/) | VERT 11/11 | SESSION-2 §2 |
| `bun run test:knowledge` | VERT 892/1/0 | SESSION-2 §2 |
| 50 packages inventoriés | OK | cette session |
| HEAD prouvé | `24b04998e2` | cette session |
| 24/25 ADR DECIDED | OK | cette session |
| 11 docs + 1 yaml foundation + 12 spikes | OK | cette session |
| Cartographies PRE-1.1 (4 cartes) | FAITES | cette session |
| Multi-review self-review | 0 Critical / 0 High | cette session |
| Working tree propre | OK (commit `cdddfc798e`) | cette session |

## Red gates (bloquantes pour M1)

| Gate | Statut | Source / Action |
|---|---|---|
| `e2e/automate` complet (8 sorties §16.3) | **ROUGE** | R-013 phase 3 (M1, après ADR-000) |
| `WorkflowRuntime` substrate-grade | **ROUGE** | R-014 + ADR-000 + M0-01 |
| `@unifia/secret-broker` (production broker OS-keyring) | **ABSENT** (scaffold in-memory OK) | ADR-010 : à porter sur DPAPI/Keychain/libsecret |
| `e2e/app` + `e2e/modes` | 22/30 PARTIEL | R-004, R-005, R-006 |
| Linux baselines visuelles | SKIP motivé | R-007 |
| `e2e/app/e2e` lint via biome | absent | R-008 |
| Tree-SHA HEAD | NON CALCULÉ | à dériver |
| `bun turbo test:ci` complet Work | NON RE-MESURÉ | R-009 |
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

## New findings (depuis PRE-0)

| ID | Sev | Description |
|---|---|---|
| C-AR-01 | Medium | Capability Authority enforcer manquant dans ADR-002 (C-PRE1-01 phase 3 ↔ M1) |
| C-AR-02 | Medium | ADR supply chain manquant |
| C-AR-03 | Medium | ADR LLM provider policy manquant |
| C-AR-04 | Low | ADR UX manquant (post-M3) |
| C-M0-06-01 | Medium | M0-06 spike : 1 MISSING enforcer (`@unifia/capability` ↔ executor boundary) |

---

## Architecture decisions (25 ADR, 24/25 DECIDED)

| ID | Sujet | Status |
|---|---|---|
| ADR-000 | Substrate (Native / DBOS / Temporal) | **PROPOSED** — spike M0-01 |
| ADR-001 | Canonicalisation (JCS + SHA-256) | **DECIDED** (M0-02 spike) |
| ADR-002 | WorkflowIR (6 node families) | **DECIDED** (Option A) |
| ADR-003 | Expression (CEL hand-roll) | **DECIDED** (M0-03 spike) |
| ADR-004 | History authority (alignée ADR-000) | **DECIDED** (native kernel) |
| ADR-005 | Artifact contract | **DECIDED** (artifact-record.ts créé) |
| ADR-006 | Execution profile / first target topology | **DECIDED** (Automate Core × local × Windows) |
| ADR-007 | Side-effect / retry semantics | **DECIDED** |
| ADR-008 | Scheduler / worker / time authority | **DECIDED** |
| ADR-009 | Policy authority | **DECIDED** |
| ADR-010 | Key / secret (OS secure + Secret Broker) | **DECIDED** (M0-04 spike, secret-broker scaffold) |
| ADR-011 | MCP compatibility | **DECIDED** |
| ADR-012 | Connector model | **DECIDED** |
| ADR-013 | Browser isolation / egress | **DECIDED** |
| ADR-014 | Computer use provider port | **DECIDED** |
| ADR-015 | Git / database authority | **DECIDED** |
| ADR-016 | History retention / archival | **DECIDED IF** (kernel natif) |
| ADR-017 | Legacy migration | **DECIDED** |
| ADR-018 | Rolling upgrade compatibility | **DECIDED** |
| ADR-019 | Code/Shell impact (post-M1) | **DECIDED** |
| ADR-020 | Ownership / deployment scope | **DECIDED** (scope.ts créé) |
| ADR-021 | Repository / module topology | **NOT TRIGGERED** |
| ADR-022 | Timer / timeout / cancellation | **DECIDED** (timer.ts créé) |
| ADR-023 | Network / SSRF (Network Authority) | **DECIDED** (M0-05 spike) |
| ADR-024 | Extension isolation (TrustClass) | **DECIDED** |

**24/25 réversibles** tant qu'aucun code de production durable n'est modifié.

---

## M1 gate (plan §197) — vérification

| Condition | Statut |
|---|---|
| PRE-0 = GO | ✓ GO_WITH_CONTAINED_DEBT (3 conditions bloquantes externes) |
| PRE-1 = COMPLETE | ✓ |
| Threat Model V1 = COMPLETE | ✓ |
| EXECUTION_PROFILE_REQUIREMENTS = FROZEN | ✓ |
| First target execution profile topology = DECIDED | ✓ (ADR-006) |
| ADR-000 = DECIDED | **PROPOSED** (bloqué par R-013 phase 3) |
| ADR-020 = DECIDED | ✓ |
| ADR-003 = DECIDED | ✓ |
| ADR-002 = DECIDED | ✓ |
| ADR-001 = DECIDED | ✓ |
| ADR-004 = DECIDED | ✓ |
| ADR-005 = DECIDED | ✓ |
| ADR-010 = DECIDED | ✓ |
| ADR-019 architectural impact = DECIDED | ✓ |
| ADR-023 architectural impact = DECIDED | ✓ |
| ADR-024 architectural impact = DECIDED | ✓ |
| ADR-016 = DECIDED IF required | ✓ IF |
| ADR-021 = DECIDED IF triggered | NOT TRIGGERED |
| Critical architecture findings = 0 | ✓ (multi-review) |
| High architecture findings = 0 | ✓ (multi-review) |

**Statut M1 gate (côté architecture documentée)** : 24/25 ADR DECIDED.
**Côté implémentation** : bloqué par R-001 (externe), ADR-000 (substrate).

---

## Statut final

`READY_FOR_REVIEW_LOCAL` (plan §18).

- Fichiers modifiés : oui
- Commits locaux : 33
- `git push` : NON
- Pull request : NON
- Merge vers dev/main/master/stable : NON
- Tag / release / publication : NON
- Déploiement du build desktop : NON

---

## Ce qui est exécuté dans cette session

- 10 fichiers Markdown dans `docs/automation-v2/`
- 1 fichier `certification/gates.yaml`
- 25 fichiers ADR dans `docs/adr/` (24 DECIDED, 1 PROPOSED)
- 6 spikes pre-M1 dans `docs/automation-v2/spikes/` (12 fichiers : 6 evidence + 6 .ts)
- 7 nouveaux modules dans `packages/contracts/src/` (scope, workflow-ir, digest, protection, credential, identity, timer) + 1 artifact-record.ts + 1 index.ts re-export
- 1 nouveau package `packages/secret-broker/` (4 fichiers, 23/23 tests verts)
- C-PRE1-01 phase 1 : 1 fichier de test statique dans `packages/app/src/pages/workbench/automate-surface.test.ts`
- C-PRE1-01 phase 2 : 1 nouveau module `packages/app/src/pages/workbench/automate-decode.ts` + 1 test `automate-decode.test.ts` + refactor de `automate-surface.tsx`
- 33 commits locaux sur `agent/automate-v2-baseline-20260901`
- **0 push, 0 merge, 0 tag, 0 modification de code durable de production**
- **pre-commit husky** : 295 fichiers vérifiés, no fixes applied sur tous les commits

## Ce qui n'est PAS exécuté

- Aucun package de `packages/` modifié en dehors de l'extraction `automate-decode` (pure refactor, comportement préservé, 1192/1192 tests verts) et des 7 modules M1 (zod schemas only, 0 runtime logic)
- Aucun code de `packages/workflow-runtime` (kernel) touché
- Aucun secret, aucune dépendance réseau ajoutée
- Les 10 worktrees MiniMax de `pr3m-20260831-090426` non touchés
- Le `BOARD.md` / `BOARD.json` vault non touché
- Le `.build-temp/` du checkout canonique non touché

## Cartographies PRE-1.1 — résolutions

| ID | Verdict | Avant | Après |
|---|---|---|---|
| R-012 | ABSENT_CREATE | NEEDS_EVIDENCE | **RESOLU_PRE-1.1** |
| R-013 | EXTEND (phase 1 livrée, phase 2 différée) | NEEDS_EVIDENCE | **RESOLU_PRE-1.1 (phase 1)** |
| R-014 | EXTEND catalog + MIGRATE runtime | NEEDS_EVIDENCE | **RESOLU_PRE-1.1 (catalog)** |
| C-PRE1-05 | ALREADY_COVERED | OPEN | **DONE** |

## Suite immédiate (bloqué externe)

1. Décision utilisateur `09f1329a8d` (R-001) — `git revert` ou confirmer
2. Décision utilisateur `GO_WITH_CONTAINED_DEBT` ou `NO_GO` formel
3. Si GO : ADR-000 (substrate) — Native / DBOS / Temporal ?
4. M1 — Durable Core (12 cartes), avec R-013 phase 2 + ADR-010 production
5. …

## Liens

- `BASELINE.md`
- `AUTOMATE_TRUST_PATH.md`
- `RISK_REGISTER.md` (avec section "Cartographies PRE-1.1 — résolutions")
- `PACKAGE_MIGRATION_MAP.md`
- `IMPLEMENTATION_CARD_INDEX.md`
- `THREAT_MODEL.md`
- `EXECUTION_PROFILE_REQUIREMENTS.md`
- `MULTI_REVIEW.md`
- `certification/gates.yaml`
- 25 ADR dans `docs/adr/`
- 6 spikes M0 dans `docs/automation-v2/spikes/`
- 7 modules M1 dans `packages/contracts/src/`
- `@unifia/secret-broker` dans `packages/secret-broker/`
- `plan V2.3.1`
- `Plan-Audit-Trois-Modes-Production-Ready-2026-08-31`
- `SESSION-2-REPORT`
