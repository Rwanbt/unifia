# UNIFIA — Plan global autonome rebaseliné v2.0

**Statut : EXECUTION-READY après RB00**  
**Date de rebaseline : 29 septembre 2026**  
**Snapshot observé : `new-ui@2c13b7d76d0fdbec33af3952825e6bf84e930df5`**  
**Autorité historique conservée : dossier global v1.5 + sources S1–S8.**

## 1. Pourquoi une v2.0 est nécessaire

Depuis le snapshot final du dossier v1.5 (`9a95392a1a3c2c840edef99f7e9bf19acbf2071d`), `new-ui` a avancé de **725 commits**. `work-design` est désormais **660 commits derrière** `new-ui`, tandis que `voice` a divergé (20 commits propres, 42 commits de `new-ui` absents). Le programme ne peut donc plus interpréter les anciens lots comme s'ils décrivaient l'état courant.

La v2.0 ne détruit pas la v1.5 : elle **reclasse** ce qui est déjà livré, ce qui est partiellement branché, ce qui reste seulement présent sous forme de package/test, et ce qui bloque réellement une release.

## 2. Definition of Done renforcée

Une capacité est `DONE` seulement si les cinq niveaux suivants sont prouvés :

1. **Contrat + autorité** : types, permissions, ownership, policy, migration et rollback définis.
2. **Implémentation réelle** : pas de stub, fixture ou donnée inventée sur le chemin production.
3. **Transport/persistence** : route, IPC, stockage ou runtime réellement atteint depuis le produit livré.
4. **Consumer livré** : UI, agent, CLI ou worker accessible depuis un shipped root.
5. **Preuve** : tests ciblés + E2E/journey/device/security selon le risque, liés au SHA exact.

Compiler, avoir des tests unitaires ou exister dans un workspace **ne suffit jamais**. `scripts/check-package-wiring.mjs` est une gate de campagne.

## 3. Objectif de release

Atteindre une Unifia où le portage v110 n’est plus une couche visuelle au-dessus de capacités incomplètes : chaque contrôle de production est réel, explicitement indisponible selon une décision approuvée, ou retiré. Le premier RC n’est autorisé qu’après fermeture des blockers runtime, Browser, Work/Automate, Voice intégré, CI/security et package wiring.

## 4. Ordre critique

`RB (rebaseline) → CR (blockers runtime) → Browser/functional closure/UI cert en parallèle → package wiring + Voice → QA/security → RL promotion/release`.

Les travaux visuels peuvent avancer en parallèle des runtimes sauf lorsqu’un visuel dépend d’un état réel encore absent (Browser, Automate, Work). Aucun worker n’est autorisé à créer un faux état pour débloquer une capture.

## 5. Phases et lots

### 0-Rebaseline

| ID | Lot | Taille | Owner | Dépendances | Issues | État initial |
|---|---|---:|---|---|---|---|
| RB00 | Freeze exact implementation baseline and branch heads | S | Release/Integration | — | — | READY |
| RB01 | Reconcile current audits, ADRs, issues and v1.5 requirements | L | Architecture | RB00 | — | READY_AFTER_RB00 |
| RB02 | Generate current branch/divergence and promotion map | M | Integration | RB00 | — | READY_AFTER_RB00 |
| RB03 | Run clean build/test/conformance baseline on an RC branch | L | QA/CI | RB00, RB02 | — | READY_AFTER_RB00 |
| RB04 | Freeze shipped-package reachability graph | M | Architecture | RB00 | — | READY_AFTER_RB00 |
| RB05 | Build end-to-end journey truth table for every visible control | XL | QA/Product | RB01, RB04 | — | READY_AFTER_RB00 |
| RB06 | Security/dependency/licence/release delta scan | L | Security/Release | RB00 | #30, #31, #33, #54 | READY_AFTER_RB00 |
| RB07 | Approve production scope and deferred-feature policy | S | Product/Architecture | RB01, RB05, RB06 | — | OWNER_DECISION |

#### RB00 — Freeze exact implementation baseline and branch heads

**Owner :** Release/Integration · **Taille :** S · **Dépendances :** aucune · **État :** READY

**Critère de sortie :** Record immutable SHAs for new-ui, work-design, voice, dev, main; dirty tree = zero; no task may claim READY against a moving baseline.

**Write scope initial :** `docs/autonomy/**`, `docs/audit/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RB01 — Reconcile current audits, ADRs, issues and v1.5 requirements

**Owner :** Architecture · **Taille :** L · **Dépendances :** RB00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Every open issue and current audit finding maps to a v2 task or an explicit out-of-scope decision; no orphan requirement.

**Write scope initial :** `docs/autonomy/**`, `docs/audit/**`, `docs/adr/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RB02 — Generate current branch/divergence and promotion map

**Owner :** Integration · **Taille :** M · **Dépendances :** RB00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Prove ancestry/divergence for new-ui/work-design/voice/dev/main and define one promotion path with rollback points.

**Write scope initial :** `docs/autonomy/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RB03 — Run clean build/test/conformance baseline on an RC branch

**Owner :** QA/CI · **Taille :** L · **Dépendances :** RB00, RB02 · **État :** READY_AFTER_RB00

**Critère de sortie :** A PR-backed candidate executes all required checks; direct-branch local green is insufficient.

**Write scope initial :** `.github/workflows/**`, `scripts/**`, `packages/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RB04 — Freeze shipped-package reachability graph

**Owner :** Architecture · **Taille :** M · **Dépendances :** RB00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Every workspace package is classified SHIPPED, INTENTIONALLY_NOT_SHIPPED, or MUST_WIRE; strategic engines cannot be counted DONE while unreachable.

**Write scope initial :** `scripts/package-wiring.json`, `scripts/check-package-wiring.mjs`, `packages/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RB05 — Build end-to-end journey truth table for every visible control

**Owner :** QA/Product · **Taille :** XL · **Dépendances :** RB01, RB04 · **État :** READY_AFTER_RB00

**Critère de sortie :** Each visible action is REAL, EXPLICITLY_DISABLED, or REMOVED. No fake data, no no-op control, no hidden runtime mismatch.

**Write scope initial :** `packages/app/**`, `docs/ui-reference/v110/**`, `docs/audit/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RB06 — Security/dependency/licence/release delta scan

**Owner :** Security/Release · **Taille :** L · **Dépendances :** RB00 · **État :** READY_AFTER_RB00

**Issues liées :** #30, #31, #33, #54

**Critère de sortie :** Current actionable findings, licences, vulnerable direct deps and release workflow blockers are enumerated with owners and tests.

**Write scope initial :** `.github/**`, `bun.lock`, `package.json`, `packages/**`, `docs/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RB07 — Approve production scope and deferred-feature policy

**Owner :** Product/Architecture · **Taille :** S · **Dépendances :** RB01, RB05, RB06 · **État :** OWNER_DECISION

**Critère de sortie :** For every SOON capability choose IMPLEMENT_BEFORE_RC or HIDE/DEFER_WITH_APPROVED_SCOPE. Production UI must not imply unsupported capability.

**Write scope initial :** `docs/autonomy/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).


### 1-Critical-runtime

| ID | Lot | Taille | Owner | Dépendances | Issues | État initial |
|---|---|---:|---|---|---|---|
| CR01 | Fix session runner deadlock after Stop on hanging generation | L | Core Runtime | RB03 | #77 | READY_AFTER_RB00 |
| CR02 | Fix fresh-install Team model selector cardinality deadlock | M | Team/UI | RB03 | #35 | READY_AFTER_RB00 |
| CR03 | Authorize workflow.run via explicit step-up capability policy | M | Security/Automate | RB01 | — | OWNER_DECISION |
| CR04 | Execute canonical Automate graph IR instead of linearized steps | XL | Automation Runtime | CR03 | — | READY_AFTER_RB00 |
| CR05 | Make Automate run authority durable for list/resume/cancel | L | Automation/Security | CR03 | — | READY_AFTER_RB00 |
| CR06 | Add safe Team task-status mutation capability | XL | Team Runtime | RB01 | #86 | READY_AFTER_RB00 |
| CR07 | Transactional/best-effort Memory wikilink refactor on rename | L | Memory | RB01 | #93 | READY_AFTER_RB00 |
| CR08 | Close remaining Code editor parity runtime gaps | XL | Code/LSP | RB01 | #96 | READY_AFTER_RB00 |
| CR09 | Remove remaining hard-coded Design copy and widen i18n guards | M | UI/i18n | RB01 | #99, #103 | READY_AFTER_RB00 |
| CR10 | Critical journey exit gate | L | QA | CR01, CR02, CR03, CR04, CR05, CR06, CR07, CR08, CR09 | — | READY_AFTER_RB00 |

#### CR01 — Fix session runner deadlock after Stop on hanging generation

**Owner :** Core Runtime · **Taille :** L · **Dépendances :** RB03 · **État :** READY_AFTER_RB00

**Issues liées :** #77

**Critère de sortie :** Abort of a never-ending generation reaches idle within bounded time; next prompt completes; direct core test + real UI E2E.

**Write scope initial :** `packages/unifia/src/effect/**`, `packages/unifia/src/session/**`, `packages/app/e2e/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### CR02 — Fix fresh-install Team model selector cardinality deadlock

**Owner :** Team/UI · **Taille :** M · **Dépendances :** RB03 · **État :** READY_AFTER_RB00

**Issues liées :** #35

**Critère de sortie :** 0→valid selection is reachable on fresh Android; save semantics match server min/max contract; device regression test.

**Write scope initial :** `packages/app/**team-model-selector**`, `packages/unifia/src/team/**`, `packages/mobile/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### CR03 — Authorize workflow.run via explicit step-up capability policy

**Owner :** Security/Automate · **Taille :** M · **Dépendances :** RB01 · **État :** OWNER_DECISION

**Critère de sortie :** workflow.run is never ambient; step-up path is approved, tested, revocable and visible in UI. If decision is deny, Run is hidden/disabled in production.

**Write scope initial :** `packages/workbench-server/**`, `packages/unifia/**`, `packages/app/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### CR04 — Execute canonical Automate graph IR instead of linearized steps

**Owner :** Automation Runtime · **Taille :** XL · **Dépendances :** CR03 · **État :** READY_AFTER_RB00

**Critère de sortie :** Branches/joins/loops execute from canonical nodes+edges; migration is versioned; graph drawn = graph executed; E2E covers true/false branch and join.

**Write scope initial :** `packages/workbench-server/**`, `packages/contracts/**`, `packages/app/src/pages/workbench/automate-**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### CR05 — Make Automate run authority durable for list/resume/cancel

**Owner :** Automation/Security · **Taille :** L · **Dépendances :** CR03 · **État :** READY_AFTER_RB00

**Critère de sortie :** A run opened in a later session can be safely resumed/cancelled using durable authority binding; no token leakage in UI/storage/logs.

**Write scope initial :** `packages/workbench-server/**`, `packages/unifia/**`, `packages/app/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### CR06 — Add safe Team task-status mutation capability

**Owner :** Team Runtime · **Taille :** XL · **Dépendances :** RB01 · **État :** READY_AFTER_RB00

**Issues liées :** #86

**Critère de sortie :** Allowed human transitions are explicit, dependency-safe and audited; SDK route exists; Kanban DnD updates canonical state and survives reload.

**Write scope initial :** `packages/unifia/src/team/**`, `packages/unifia/src/server/routes/team.ts`, `packages/sdk/**`, `packages/app/**work-board**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### CR07 — Transactional/best-effort Memory wikilink refactor on rename

**Owner :** Memory · **Taille :** L · **Dépendances :** RB01 · **État :** READY_AFTER_RB00

**Issues liées :** #93

**Critère de sortie :** Unambiguous wikilinks rewrite with CAS, partial failures surface precisely, backlinks remain correct, real-file E2E.

**Write scope initial :** `packages/app/**memory**`, `packages/workbench-server/**`, `packages/unifia/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### CR08 — Close remaining Code editor parity runtime gaps

**Owner :** Code/LSP · **Taille :** XL · **Dépendances :** RB01 · **État :** READY_AFTER_RB00

**Issues liées :** #96

**Critère de sortie :** Code lens, inline AI and any still-missing marker/blame capability are real or explicitly unavailable; matrix reflects measured reality.

**Write scope initial :** `packages/ui/src/components/code-mirror*`, `packages/app/src/pages/session/**`, `packages/unifia/src/lsp/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### CR09 — Remove remaining hard-coded Design copy and widen i18n guards

**Owner :** UI/i18n · **Taille :** M · **Dépendances :** RB01 · **État :** READY_AFTER_RB00

**Issues liées :** #99, #103

**Critère de sortie :** All user-facing Design copy uses i18n; 17 dictionaries pass; guard covers full design surface family.

**Write scope initial :** `packages/app/src/pages/workbench/design-**`, `packages/app/src/i18n/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### CR10 — Critical journey exit gate

**Owner :** QA · **Taille :** L · **Dépendances :** CR01, CR02, CR03, CR04, CR05, CR06, CR07, CR08, CR09 · **État :** READY_AFTER_RB00

**Critère de sortie :** Stop/retry, Team selection, Work DnD, Automate run/branch/cancel, Memory rename, Code editor and Design i18n journeys pass on clean candidate.

**Write scope initial :** `packages/app/e2e/**`, `packages/unifia/test/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).


### 2-UI-UX-certification

| ID | Lot | Taille | Owner | Dépendances | Issues | État initial |
|---|---|---:|---|---|---|---|
| UI00 | Reconcile pixel-perfect issue #116 with current implementation | M | UI Architecture | RB01 | #116 | READY_AFTER_RB00 |
| UI01 | Certify and complete deterministic visual parity harness | L | Visual QA | UI00 | — | READY_AFTER_RB00 |
| UI02 | Freeze typography/tokens/assets for deterministic rendering | M | Design System | UI01 | — | READY_AFTER_RB00 |
| UI03 | Pixel-parity closure: Home | L | UI/Visual QA | UI02 | — | READY_AFTER_RB00 |
| UI04 | Pixel-parity closure: Shell | L | UI/Visual QA | UI02 | — | READY_AFTER_RB00 |
| UI05 | Pixel-parity closure: Chat/session | L | UI/Visual QA | UI02 | — | READY_AFTER_RB00 |
| UI06 | Pixel-parity closure: Code | L | UI/Visual QA | UI02 | — | READY_AFTER_RB00 |
| UI07 | Pixel-parity closure: Work | L | UI/Visual QA | UI02, CR06 | — | READY_AFTER_RB00 |
| UI08 | Pixel-parity closure: Design | L | UI/Visual QA | UI02 | — | READY_AFTER_RB00 |
| UI09 | Pixel-parity closure: Automate | L | UI/Visual QA | UI02, CR04 | — | READY_AFTER_RB00 |
| UI10 | Pixel-parity closure: Memory | L | UI/Visual QA | UI02 | — | READY_AFTER_RB00 |
| UI11 | Pixel-parity closure: Settings/User | L | UI/Visual QA | UI02 | — | READY_AFTER_RB00 |
| UI12 | Pixel-parity closure: Browser after real runtime integration | L | Browser/UI | UI02, BR10 | #97, #118 | READY_AFTER_RB00 |
| UI13 | Responsive matrix across all shipped surfaces | XL | UI/QA | UI03, UI04, UI05, UI06, UI07, UI08, UI09, UI10, UI11, UI12 | — | READY_AFTER_RB00 |
| UI14 | Motion, hover, keyboard and reduced-motion certification | L | UI/A11y | UI13 | — | READY_AFTER_RB00 |
| UI15 | A11y + final visual gate | L | QA/A11y | UI14 | — | READY_AFTER_RB00 |

#### UI00 — Reconcile pixel-perfect issue #116 with current implementation

**Owner :** UI Architecture · **Taille :** M · **Dépendances :** RB01 · **État :** READY_AFTER_RB00

**Issues liées :** #116

**Critère de sortie :** Mark each S0-S14 slice DONE/PARTIAL/OPEN using current repo evidence; never reimplement delivered work blindly.

**Write scope initial :** `docs/ui-reference/v110/**`, `packages/app/scripts/parity/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI01 — Certify and complete deterministic visual parity harness

**Owner :** Visual QA · **Taille :** L · **Dépendances :** UI00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Reference/app capture, pixel diff, deterministic fixtures, DPR 1x/2x, thresholds and CI artifact publication work on clean runner.

**Write scope initial :** `packages/app/scripts/parity/**`, `packages/app/e2e/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI02 — Freeze typography/tokens/assets for deterministic rendering

**Owner :** Design System · **Taille :** M · **Dépendances :** UI01 · **État :** READY_AFTER_RB00

**Critère de sortie :** Font/token provenance is deterministic; no machine-dependent fallback alters visual gate.

**Write scope initial :** `packages/app/src/styles/**`, `packages/ui/src/assets/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI03 — Pixel-parity closure: Home

**Owner :** UI/Visual QA · **Taille :** L · **Dépendances :** UI02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Home matches frozen v110 reference across applicable states/viewports within approved thresholds; no functional regression.

**Write scope initial :** `packages/app/src/**`, `packages/app/e2e/v110/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI04 — Pixel-parity closure: Shell

**Owner :** UI/Visual QA · **Taille :** L · **Dépendances :** UI02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Shell matches frozen v110 reference across applicable states/viewports within approved thresholds; no functional regression.

**Write scope initial :** `packages/app/src/**`, `packages/app/e2e/v110/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI05 — Pixel-parity closure: Chat/session

**Owner :** UI/Visual QA · **Taille :** L · **Dépendances :** UI02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Chat/session matches frozen v110 reference across applicable states/viewports within approved thresholds; no functional regression.

**Write scope initial :** `packages/app/src/**`, `packages/app/e2e/v110/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI06 — Pixel-parity closure: Code

**Owner :** UI/Visual QA · **Taille :** L · **Dépendances :** UI02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Code matches frozen v110 reference across applicable states/viewports within approved thresholds; no functional regression.

**Write scope initial :** `packages/app/src/**`, `packages/app/e2e/v110/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI07 — Pixel-parity closure: Work

**Owner :** UI/Visual QA · **Taille :** L · **Dépendances :** UI02, CR06 · **État :** READY_AFTER_RB00

**Critère de sortie :** Work matches frozen v110 reference across applicable states/viewports within approved thresholds; no functional regression.

**Write scope initial :** `packages/app/src/**`, `packages/app/e2e/v110/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI08 — Pixel-parity closure: Design

**Owner :** UI/Visual QA · **Taille :** L · **Dépendances :** UI02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Design matches frozen v110 reference across applicable states/viewports within approved thresholds; no functional regression.

**Write scope initial :** `packages/app/src/**`, `packages/app/e2e/v110/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI09 — Pixel-parity closure: Automate

**Owner :** UI/Visual QA · **Taille :** L · **Dépendances :** UI02, CR04 · **État :** READY_AFTER_RB00

**Critère de sortie :** Automate matches frozen v110 reference across applicable states/viewports within approved thresholds; no functional regression.

**Write scope initial :** `packages/app/src/**`, `packages/app/e2e/v110/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI10 — Pixel-parity closure: Memory

**Owner :** UI/Visual QA · **Taille :** L · **Dépendances :** UI02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Memory matches frozen v110 reference across applicable states/viewports within approved thresholds; no functional regression.

**Write scope initial :** `packages/app/src/**`, `packages/app/e2e/v110/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI11 — Pixel-parity closure: Settings/User

**Owner :** UI/Visual QA · **Taille :** L · **Dépendances :** UI02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Settings/User matches frozen v110 reference across applicable states/viewports within approved thresholds; no functional regression.

**Write scope initial :** `packages/app/src/**`, `packages/app/e2e/v110/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI12 — Pixel-parity closure: Browser after real runtime integration

**Owner :** Browser/UI · **Taille :** L · **Dépendances :** UI02, BR10 · **État :** READY_AFTER_RB00

**Issues liées :** #97, #118

**Critère de sortie :** Browser chrome reflects real tabs/controller/activity state; no fake controls; visual thresholds met.

**Write scope initial :** `packages/app/**browser**`, `packages/app/e2e/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI13 — Responsive matrix across all shipped surfaces

**Owner :** UI/QA · **Taille :** XL · **Dépendances :** UI03, UI04, UI05, UI06, UI07, UI08, UI09, UI10, UI11, UI12 · **État :** READY_AFTER_RB00

**Critère de sortie :** All required viewport families pass overflow, navigation, panel, orientation and visual gates.

**Write scope initial :** `packages/app/**`, `docs/ui-reference/v110/RESPONSIVE-MATRIX.md` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI14 — Motion, hover, keyboard and reduced-motion certification

**Owner :** UI/A11y · **Taille :** L · **Dépendances :** UI13 · **État :** READY_AFTER_RB00

**Critère de sortie :** Motion contract and hover panels match reference; reduced-motion removes nonessential motion; keyboard paths remain usable.

**Write scope initial :** `packages/app/**`, `packages/ui/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### UI15 — A11y + final visual gate

**Owner :** QA/A11y · **Taille :** L · **Dépendances :** UI14 · **État :** READY_AFTER_RB00

**Critère de sortie :** No blocking accessibility defect; visual matrix green; approved exceptions versioned; #116 can close.

**Write scope initial :** `packages/app/e2e/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).


### 3-Browser

| ID | Lot | Taille | Owner | Dépendances | Issues | État initial |
|---|---|---:|---|---|---|---|
| BR00 | Preserve Browser route/session/workspace identity | M | Browser | RB01 | #118 | READY_AFTER_RB00 |
| BR01 | Canonical Browser service, session/tab lifecycle and active-tab authority | XL | Browser Runtime | BR00 | #118 | READY_AFTER_RB00 |
| BR02 | Render the same Browser runtime that receives actions | L | Browser/Desktop | BR01 | — | READY_AFTER_RB00 |
| BR03 | Workbench Browser transport/events and agent tools | XL | Browser/Agent | BR01, BR02 | — | READY_AFTER_RB00 |
| BR04 | Observation receipts and stale-action rejection | L | Browser/Security | BR03 | — | READY_AFTER_RB00 |
| BR05 | User takeover / AI pause-resume authority | L | Browser/Security | BR04 | — | READY_AFTER_RB00 |
| BR06 | Route Browser network through Network Authority and SSRF policy | XL | Security/Network | BR01 | #118 | READY_AFTER_RB00 |
| BR07 | Secret scrubbing and prompt-injection boundaries | XL | Security | BR03, BR06 | — | READY_AFTER_RB00 |
| BR08 | Download quarantine and explicit release flow | L | Browser/Security | BR06 | — | READY_AFTER_RB00 |
| BR09 | Workspace profile isolation, popup/permission/device policy | L | Browser | BR01, BR06 | — | READY_AFTER_RB00 |
| BR10 | Browser E2E and security certification | XL | QA/Security | BR02, BR03, BR04, BR05, BR06, BR07, BR08, BR09 | #97, #118 | READY_AFTER_RB00 |

#### BR00 — Preserve Browser route/session/workspace identity

**Owner :** Browser · **Taille :** M · **Dépendances :** RB01 · **État :** READY_AFTER_RB00

**Issues liées :** #118

**Critère de sortie :** Navigating Browser↔Work/Code/project does not destroy or silently remap Browser session.

**Write scope initial :** `packages/app/**`, `packages/contracts/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR01 — Canonical Browser service, session/tab lifecycle and active-tab authority

**Owner :** Browser Runtime · **Taille :** XL · **Dépendances :** BR00 · **État :** READY_AFTER_RB00

**Issues liées :** #118

**Critère de sortie :** Stable IDs; lifecycle owned by service not component; resources released on close/workspace teardown.

**Write scope initial :** `packages/browser-runtime/**`, `packages/contracts/**`, `packages/workbench-server/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR02 — Render the same Browser runtime that receives actions

**Owner :** Browser/Desktop · **Taille :** L · **Dépendances :** BR01 · **État :** READY_AFTER_RB00

**Critère de sortie :** Displayed active tab/page is exactly the page user and agent commands target.

**Write scope initial :** `packages/app/**browser**`, `packages/desktop/**`, `packages/browser-runtime/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR03 — Workbench Browser transport/events and agent tools

**Owner :** Browser/Agent · **Taille :** XL · **Dépendances :** BR01, BR02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Agent tools act through canonical service; activity events are runtime-derived; unsupported actions fail explicitly.

**Write scope initial :** `packages/workbench-server/**`, `packages/unifia/**`, `packages/browser-runtime/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR04 — Observation receipts and stale-action rejection

**Owner :** Browser/Security · **Taille :** L · **Dépendances :** BR03 · **État :** READY_AFTER_RB00

**Critère de sortie :** Actions require fresh receipt bound to tab/page/origin/URL/state digest; stale receipt is rejected deterministically.

**Write scope initial :** `packages/browser-runtime/**`, `packages/contracts/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR05 — User takeover / AI pause-resume authority

**Owner :** Browser/Security · **Taille :** L · **Dépendances :** BR04 · **État :** READY_AFTER_RB00

**Critère de sortie :** Takeover stops pending AI immediately; resume requires fresh observation; state is visible and auditable.

**Write scope initial :** `packages/browser-runtime/**`, `packages/app/**browser**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR06 — Route Browser network through Network Authority and SSRF policy

**Owner :** Security/Network · **Taille :** XL · **Dépendances :** BR01 · **État :** READY_AFTER_RB00

**Issues liées :** #118

**Critère de sortie :** DNS/IP/redirect revalidation, capability checks and forbidden-destination corpus pass fail-closed.

**Write scope initial :** `packages/browser-runtime/**`, `packages/computer-use-safety/**`, `packages/capability-runtime/**`, `packages/unifia/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR07 — Secret scrubbing and prompt-injection boundaries

**Owner :** Security · **Taille :** XL · **Dépendances :** BR03, BR06 · **État :** READY_AFTER_RB00

**Critère de sortie :** DOM/a11y/screenshot/log/history/trace/artifact/export are scrubbed before model exposure; privileged secret flow cannot be bypassed.

**Write scope initial :** `packages/browser-runtime/**`, `packages/secret-broker/**`, `packages/computer-use-safety/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR08 — Download quarantine and explicit release flow

**Owner :** Browser/Security · **Taille :** L · **Dépendances :** BR06 · **État :** READY_AFTER_RB00

**Critère de sortie :** Downloads remain quarantined until validation/policy/approval release; provenance and hash retained.

**Write scope initial :** `packages/browser-runtime/**`, `packages/artifact-store/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR09 — Workspace profile isolation, popup/permission/device policy

**Owner :** Browser · **Taille :** L · **Dépendances :** BR01, BR06 · **État :** READY_AFTER_RB00

**Critère de sortie :** Cookies/profiles isolated by workspace; popup/upload/permissions/device emulation are real or explicitly unavailable.

**Write scope initial :** `packages/browser-runtime/**`, `packages/app/**browser**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### BR10 — Browser E2E and security certification

**Owner :** QA/Security · **Taille :** XL · **Dépendances :** BR02, BR03, BR04, BR05, BR06, BR07, BR08, BR09 · **État :** READY_AFTER_RB00

**Issues liées :** #97, #118

**Critère de sortie :** Route/tab/action/takeover/stale observation/SSRF/secret/download/isolation suites pass and issue #118 acceptance is fully evidenced.

**Write scope initial :** `packages/app/e2e/**`, `packages/browser-runtime/**`, `docs/ui-reference/v110/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).


### 4-Functional-closure

| ID | Lot | Taille | Owner | Dépendances | Issues | État initial |
|---|---|---:|---|---|---|---|
| FX00 | Classify every SOON/disabled control against production scope | M | Product/QA | RB05, RB07 | — | READY_AFTER_RB00 |
| FX01 | Work action APIs: Run, Approve, Policy, Undo, Generate update | XL | Team/Work | CR06, FX00 | — | READY_AFTER_RB00 |
| FX02 | Automate dry-run/test mode, fixtures and → Work handoff | XL | Automation/Work | CR04, FX00 | — | READY_AFTER_RB00 |
| FX03 | Automate scheduler and external trigger closure | XL | Automation | CR04 | — | READY_AFTER_RB00 |
| FX04 | Node configuration editors for runnable Automate families | XL | Automation/UI | CR04 | — | READY_AFTER_RB00 |
| FX05 | Terminal Problems/Output/Tests/Debug/Ports producers | XL | Code/DevTools | FX00 | — | READY_AFTER_RB00 |
| FX06 | Code inspector context injection and task actions | L | Code/Agent | FX00, CR08 | — | READY_AFTER_RB00 |
| FX07 | Settings AI routing/local/fallback profiles | L | Settings/Inference | FX00 | — | READY_AFTER_RB00 |
| FX08 | Settings Compute/Network/Security/System/Hooks backends | XL | Settings/Platform | FX00 | — | READY_AFTER_RB00 |
| FX09 | Account session sync/security/org actions | XL | Account/Auth | FX00 | — | READY_AFTER_RB00 |
| FX10 | Observability producers for declared domains | L | Observability | FX01, FX02, BR10 | — | READY_AFTER_RB00 |
| FX11 | Functional-closure E2E matrix | XL | QA | FX01, FX02, FX03, FX04, FX05, FX06, FX07, FX08, FX09, FX10 | — | READY_AFTER_RB00 |

#### FX00 — Classify every SOON/disabled control against production scope

**Owner :** Product/QA · **Taille :** M · **Dépendances :** RB05, RB07 · **État :** READY_AFTER_RB00

**Critère de sortie :** Every SOON control gets implementation task or approved removal/hide decision.

**Write scope initial :** `packages/app/**`, `docs/audit/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX01 — Work action APIs: Run, Approve, Policy, Undo, Generate update

**Owner :** Team/Work · **Taille :** XL · **Dépendances :** CR06, FX00 · **État :** READY_AFTER_RB00

**Critère de sortie :** All in-scope Work actions call canonical Team APIs and return observable durable results.

**Write scope initial :** `packages/unifia/src/team/**`, `packages/app/**work**`, `packages/sdk/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX02 — Automate dry-run/test mode, fixtures and → Work handoff

**Owner :** Automation/Work · **Taille :** XL · **Dépendances :** CR04, FX00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Test mode has fixtures/storage; →Work creates real task linked to workflow/run provenance.

**Write scope initial :** `packages/workbench-server/**`, `packages/app/**automate**`, `packages/unifia/src/team/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX03 — Automate scheduler and external trigger closure

**Owner :** Automation · **Taille :** XL · **Dépendances :** CR04 · **État :** READY_AFTER_RB00

**Critère de sortie :** schedule trigger fires durably; watch/webhook ownership explicit; missed/retry semantics tested.

**Write scope initial :** `packages/scheduler/**`, `packages/workbench-server/**`, `packages/app/**automate**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX04 — Node configuration editors for runnable Automate families

**Owner :** Automation/UI · **Taille :** XL · **Dépendances :** CR04 · **État :** READY_AFTER_RB00

**Critère de sortie :** Previously disabled control/switch/parallel/merge/map/repeat/while/child/http/transform families have validated config or remain hidden by approved scope.

**Write scope initial :** `packages/app/**automate**`, `packages/contracts/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX05 — Terminal Problems/Output/Tests/Debug/Ports producers

**Owner :** Code/DevTools · **Taille :** XL · **Dépendances :** FX00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Each shipped tab has a real producer and interaction model; otherwise removed from production chrome.

**Write scope initial :** `packages/app/**terminal**`, `packages/unifia/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX06 — Code inspector context injection and task actions

**Owner :** Code/Agent · **Taille :** L · **Dépendances :** FX00, CR08 · **État :** READY_AFTER_RB00

**Critère de sortie :** Add selection/file/folder/terminal and task actions alter real prompt/task context with provenance and permissions.

**Write scope initial :** `packages/app/src/pages/session/code-inspector/**`, `packages/unifia/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX07 — Settings AI routing/local/fallback profiles

**Owner :** Settings/Inference · **Taille :** L · **Dépendances :** FX00 · **État :** READY_AFTER_RB00

**Critère de sortie :** All enabled profiles map to actual routing policy; unavailable providers are not selectable.

**Write scope initial :** `packages/app/src/components/settings-ai-preferences*`, `packages/unifia/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX08 — Settings Compute/Network/Security/System/Hooks backends

**Owner :** Settings/Platform · **Taille :** XL · **Dépendances :** FX00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Each in-scope control is backed by persisted platform config/action and error handling; no no-op handler remains.

**Write scope initial :** `packages/app/src/components/settings-*`, `packages/unifia/**`, `packages/desktop/**`, `packages/mobile/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX09 — Account session sync/security/org actions

**Owner :** Account/Auth · **Taille :** XL · **Dépendances :** FX00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Restore/sync and approved security/account actions are backed by real authorities or removed from production scope.

**Write scope initial :** `packages/app/src/components/account/**`, `packages/unifia/src/auth/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX10 — Observability producers for declared domains

**Owner :** Observability · **Taille :** L · **Dépendances :** FX01, FX02, BR10 · **État :** READY_AFTER_RB00

**Critère de sortie :** artifact/approval/browser/process/routing/policy/hooks domains have real emitters, retention and UI views or are deleted from schema.

**Write scope initial :** `packages/observability/**`, `packages/unifia/**`, `packages/app/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### FX11 — Functional-closure E2E matrix

**Owner :** QA · **Taille :** XL · **Dépendances :** FX01, FX02, FX03, FX04, FX05, FX06, FX07, FX08, FX09, FX10 · **État :** READY_AFTER_RB00

**Critère de sortie :** No in-scope production control is fake, one-shot, unreachable, or silently failing across desktop/web/mobile applicability.

**Write scope initial :** `packages/app/e2e/**`, `packages/unifia/test/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).


### 5-Package-wiring

| ID | Lot | Taille | Owner | Dépendances | Issues | État initial |
|---|---|---:|---|---|---|---|
| PW00 | Strategic package wiring policy | M | Architecture | RB04, RB07 | — | READY_AFTER_RB00 |
| PW01 | Wire capability-runtime into shipped authority path | L | Architecture/Runtime | PW00, CR03 | — | READY_AFTER_RB00 |
| PW02 | Wire secret-broker into shipped secret/tool/browser boundaries | L | Architecture/Runtime | PW00, BR07 | — | READY_AFTER_RB00 |
| PW03 | Wire observability package into canonical event path | L | Architecture/Runtime | PW00, FX10 | — | READY_AFTER_RB00 |
| PW04 | Wire memory-governance or replace with canonical shipped authority | L | Architecture/Runtime | PW00, CR07 | — | READY_AFTER_RB00 |
| PW05 | Wire workbench-orchestrator into Work/Team execution or deprecate it | L | Architecture/Runtime | PW00, FX01 | — | READY_AFTER_RB00 |
| PW06 | Wire browser-runtime into Browser service | L | Architecture/Runtime | PW00, BR01 | — | READY_AFTER_RB00 |
| PW07 | Wire sandbox-drivers + computer-use-safety where privileged execution ships | XL | Architecture/Runtime | PW00, BR06 | — | READY_AFTER_RB00 |
| PW08 | Wire artifact-store/studio/document-packs/generative-ui where production artifacts require them | XL | Architecture/Runtime | PW00 | — | READY_AFTER_RB00 |
| PW09 | Wire scheduler/media-runtime where triggers/voice/multimodal require them | L | Architecture/Runtime | PW00, FX03, VO02 | — | READY_AFTER_RB00 |
| PW10 | Resolve remote-bridge/desktop-runtime against device/control-plane scope | XL | Architecture/Runtime | PW00 | — | READY_AFTER_RB00 |
| PW11 | Package reachability final gate | M | Architecture/QA | PW01, PW02, PW03, PW04, PW05, PW06, PW07, PW08, PW09, PW10 | — | READY_AFTER_RB00 |

#### PW00 — Strategic package wiring policy

**Owner :** Architecture · **Taille :** M · **Dépendances :** RB04, RB07 · **État :** READY_AFTER_RB00

**Critère de sortie :** Each strategic notShipped package gets WIRE_BEFORE_RC, POST_RC, or DELETE/PARK with explicit product rationale.

**Write scope initial :** `scripts/package-wiring.json`, `docs/autonomy/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW01 — Wire capability-runtime into shipped authority path

**Owner :** Architecture/Runtime · **Taille :** L · **Dépendances :** PW00, CR03 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW02 — Wire secret-broker into shipped secret/tool/browser boundaries

**Owner :** Architecture/Runtime · **Taille :** L · **Dépendances :** PW00, BR07 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW03 — Wire observability package into canonical event path

**Owner :** Architecture/Runtime · **Taille :** L · **Dépendances :** PW00, FX10 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW04 — Wire memory-governance or replace with canonical shipped authority

**Owner :** Architecture/Runtime · **Taille :** L · **Dépendances :** PW00, CR07 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW05 — Wire workbench-orchestrator into Work/Team execution or deprecate it

**Owner :** Architecture/Runtime · **Taille :** L · **Dépendances :** PW00, FX01 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW06 — Wire browser-runtime into Browser service

**Owner :** Architecture/Runtime · **Taille :** L · **Dépendances :** PW00, BR01 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW07 — Wire sandbox-drivers + computer-use-safety where privileged execution ships

**Owner :** Architecture/Runtime · **Taille :** XL · **Dépendances :** PW00, BR06 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW08 — Wire artifact-store/studio/document-packs/generative-ui where production artifacts require them

**Owner :** Architecture/Runtime · **Taille :** XL · **Dépendances :** PW00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW09 — Wire scheduler/media-runtime where triggers/voice/multimodal require them

**Owner :** Architecture/Runtime · **Taille :** L · **Dépendances :** PW00, FX03, VO02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW10 — Resolve remote-bridge/desktop-runtime against device/control-plane scope

**Owner :** Architecture/Runtime · **Taille :** XL · **Dépendances :** PW00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Package is reachable from a shipped root with real consumer/E2E, or explicitly removed/parked; package-wiring gate stays green.

**Write scope initial :** `packages/**`, `scripts/package-wiring.json` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### PW11 — Package reachability final gate

**Owner :** Architecture/QA · **Taille :** M · **Dépendances :** PW01, PW02, PW03, PW04, PW05, PW06, PW07, PW08, PW09, PW10 · **État :** READY_AFTER_RB00

**Critère de sortie :** No strategic package is misclassified as implemented while unreachable; all intentional non-shipped entries are documented and stable.

**Write scope initial :** `scripts/package-wiring.json`, `scripts/check-package-wiring.mjs` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).


### 6-Voice

| ID | Lot | Taille | Owner | Dépendances | Issues | État initial |
|---|---|---:|---|---|---|---|
| VO00 | Freeze voice/new-ui divergence and integration strategy | M | Voice/Integration | RB02 | #117 | READY_AFTER_RB00 |
| VO01 | Integrate voice changes onto current new-ui candidate | XL | Voice/Integration | VO00 | — | READY_AFTER_RB00 |
| VO02 | Complete Voice v2.2 G0-G14 implementation | XL | Voice Runtime | VO01 | #117 | READY_AFTER_RB00 |
| VO03 | Blocking Voice CI and deterministic model-artifact qualification | L | Voice/CI | VO02 | — | READY_AFTER_RB00 |
| VO04 | Physical Android + Windows voice qualification | XL | QA/Voice | VO03 | — | READY_AFTER_RB00 |
| VO05 | Merge-qualified voice into RC | M | Integration | VO04 | — | READY_AFTER_RB00 |

#### VO00 — Freeze voice/new-ui divergence and integration strategy

**Owner :** Voice/Integration · **Taille :** M · **Dépendances :** RB02 · **État :** READY_AFTER_RB00

**Issues liées :** #117

**Critère de sortie :** 20 voice-only commits and 42 new-ui-only commits are classified; integration uses a fresh branch from current new-ui without force/rebase history rewriting.

**Write scope initial :** `docs/operations/voice-v2-autonomous-state.md`, `docs/autonomy/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### VO01 — Integrate voice changes onto current new-ui candidate

**Owner :** Voice/Integration · **Taille :** XL · **Dépendances :** VO00 · **État :** READY_AFTER_RB00

**Critère de sortie :** Voice feature branch contains current new-ui plus intended voice changes; conflicts resolved semantically; all shared app tests pass.

**Write scope initial :** `.github/workflows/voice-ci.yml`, `packages/app/src/voice/**`, `packages/mobile/**`, `crates/unifia-voice-artifacts/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### VO02 — Complete Voice v2.2 G0-G14 implementation

**Owner :** Voice Runtime · **Taille :** XL · **Dépendances :** VO01 · **État :** READY_AFTER_RB00

**Issues liées :** #117

**Critère de sortie :** Production providers/semantics are real; model artifacts immutable/hash-verified; Voice remains I/O-only and cannot bypass agent authority.

**Write scope initial :** `packages/app/src/voice/**`, `packages/mobile/**`, `crates/**`, `docs/operations/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### VO03 — Blocking Voice CI and deterministic model-artifact qualification

**Owner :** Voice/CI · **Taille :** L · **Dépendances :** VO02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Mandatory jobs block merge; no hidden collection failures; evidence tied to exact SHA and immutable artifacts.

**Write scope initial :** `.github/workflows/voice-ci.yml`, `docs/operations/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### VO04 — Physical Android + Windows voice qualification

**Owner :** QA/Voice · **Taille :** XL · **Dépendances :** VO03 · **État :** READY_AFTER_RB00

**Critère de sortie :** Required languages, offline/local, full-duplex, resource coexistence, endurance, Bluetooth/routes and Windows Live have reproducible evidence or explicit external blocker.

**Write scope initial :** `docs/UNIFIA-VOICE-V2.2-FINAL-QUALIFICATION.md`, `docs/operations/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### VO05 — Merge-qualified voice into RC

**Owner :** Integration · **Taille :** M · **Dépendances :** VO04 · **État :** READY_AFTER_RB00

**Critère de sortie :** Voice merges only after G0-G14 evidence and full shared CI; post-merge app/desktop/mobile smoke remains green.

**Write scope initial :** `packages/**`, `.github/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).


### 7-Prod-hardening

| ID | Lot | Taille | Owner | Dépendances | Issues | État initial |
|---|---|---:|---|---|---|---|
| QA00 | Fix conformance fail-fast so full failure set is visible | S | CI | RB03 | #55 | READY_AFTER_RB00 |
| QA01 | Remove/repair stuck check-duplicates status | S | CI | RB03 | #59 | READY_AFTER_RB00 |
| QA02 | Harden Windows unit flakes and instance-capacity nondeterminism | L | QA/CI | RB03 | #56, #57 | READY_AFTER_RB00 |
| QA03 | Harden E2E runner starvation/flakes | L | QA/CI | RB03 | #58 | READY_AFTER_RB00 |
| QA04 | Close CodeQL/security + LSP E2E production gate | L | Security/QA | RB06 | #30 | READY_AFTER_RB00 |
| QA05 | Patch/triage direct dependency vulnerabilities in isolated batches | XL | Security/Dependencies | RB06 | #33 | READY_AFTER_RB00 |
| QA06 | Declare direct cross-package dependencies instead of relying on hoisting | L | Dependencies | RB06 | #54 | READY_AFTER_RB00 |
| QA07 | Verify unifia.ai remediation and no executable dangling domain | M | Security/Brand | RB06 | #31 | READY_AFTER_RB00 |
| QA08 | Physical mobile QA and release sign-offs | XL | QA/Mobile | CR02, VO04 | — | READY_AFTER_RB00 |
| QA09 | Release workflow/signing/SBOM/SLSA dry run | L | Release/Security | QA04, QA05 | — | READY_AFTER_RB00 |
| QA10 | Protected-branch policy for integration promotion | M | Governance | RB02, QA00, QA01 | — | READY_AFTER_RB00 |
| QA11 | Cross-platform production target matrix and platform qualification | XL | QA/Platform | CR10, UI15, BR10, FX11, PW11, VO05, QA08, QA09 | — | READY_AFTER_RB00 |
| QA12 | Production hardening gate | XL | Release/QA/Security | CR10, UI15, BR10, FX11, PW11, VO05, QA02, QA03, QA04, QA05, QA06, QA07, QA08, QA09, QA10, QA11 | — | READY_AFTER_RB00 |

#### QA00 — Fix conformance fail-fast so full failure set is visible

**Owner :** CI · **Taille :** S · **Dépendances :** RB03 · **État :** READY_AFTER_RB00

**Issues liées :** #55

**Critère de sortie :** Conformance reports all failed tasks/logs in one run without hiding downstream failures.

**Write scope initial :** `scripts/unifia-conformance.mjs`, `.github/workflows/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA01 — Remove/repair stuck check-duplicates status

**Owner :** CI · **Taille :** S · **Dépendances :** RB03 · **État :** READY_AFTER_RB00

**Issues liées :** #59

**Critère de sortie :** Every PR deterministically reports pass/skip/fail; no permanently Expected check.

**Write scope initial :** `.github/workflows/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA02 — Harden Windows unit flakes and instance-capacity nondeterminism

**Owner :** QA/CI · **Taille :** L · **Dépendances :** RB03 · **État :** READY_AFTER_RB00

**Issues liées :** #56, #57

**Critère de sortie :** Repeated identical SHA runs do not diverge for known flaky tests; clocks/disposal are deterministic or isolated.

**Write scope initial :** `packages/unifia/test/**`, `.github/workflows/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA03 — Harden E2E runner starvation/flakes

**Owner :** QA/CI · **Taille :** L · **Dépendances :** RB03 · **État :** READY_AFTER_RB00

**Issues liées :** #58

**Critère de sortie :** Suite sharding/timeouts/runner sizing remove systemic 45s visibility flakes; identical SHA reruns stable.

**Write scope initial :** `packages/app/e2e/**`, `.github/workflows/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA04 — Close CodeQL/security + LSP E2E production gate

**Owner :** Security/QA · **Taille :** L · **Dépendances :** RB06 · **État :** READY_AFTER_RB00

**Issues liées :** #30

**Critère de sortie :** Actionable CodeQL resolved/dispositioned; LSP enabled by default in E2E; regression cases pass.

**Write scope initial :** `.github/workflows/**`, `packages/unifia/**`, `packages/app/e2e/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA05 — Patch/triage direct dependency vulnerabilities in isolated batches

**Owner :** Security/Dependencies · **Taille :** XL · **Dépendances :** RB06 · **État :** READY_AFTER_RB00

**Issues liées :** #33

**Critère de sortie :** Direct patchable vulnerabilities closed; SDK regenerated where generator changes types; each batch typechecks/tests.

**Write scope initial :** `package.json`, `packages/*/package.json`, `bun.lock`, `packages/sdk/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA06 — Declare direct cross-package dependencies instead of relying on hoisting

**Owner :** Dependencies · **Taille :** L · **Dépendances :** RB06 · **État :** READY_AFTER_RB00

**Issues liées :** #54

**Critère de sortie :** Every package declares imported runtime deps; isolated installs for representative packages succeed.

**Write scope initial :** `packages/*/package.json`, `bun.lock` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA07 — Verify unifia.ai remediation and no executable dangling domain

**Owner :** Security/Brand · **Taille :** M · **Dépendances :** RB06 · **État :** READY_AFTER_RB00

**Issues liées :** #31

**Critère de sortie :** No executable surface targets unowned unifia.ai; deploy is explicit opt-in; canonical public location is approved.

**Write scope initial :** `infra/**`, `.github/**`, `packages/**`, `docs/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA08 — Physical mobile QA and release sign-offs

**Owner :** QA/Mobile · **Taille :** XL · **Dépendances :** CR02, VO04 · **État :** READY_AFTER_RB00

**Critère de sortie :** Required OEM/device checks signed with exact build SHA; critical mobile regressions zero.

**Write scope initial :** `QA_ANDROID_DEVICES.md`, `docs/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA09 — Release workflow/signing/SBOM/SLSA dry run

**Owner :** Release/Security · **Taille :** L · **Dépendances :** QA04, QA05 · **État :** READY_AFTER_RB00

**Critère de sortie :** Dry-run produces installable artifacts + signatures/checksums/SBOM/provenance without publishing production release.

**Write scope initial :** `.github/workflows/**`, `RELEASE_NOTES_TEMPLATE.md` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA10 — Protected-branch policy for integration promotion

**Owner :** Governance · **Taille :** M · **Dépendances :** RB02, QA00, QA01 · **État :** READY_AFTER_RB00

**Critère de sortie :** RC/promotion goes through PR with required checks; no unreviewed direct promotion; required checks are unconditional.

**Write scope initial :** `.github/**`, `docs/autonomy/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA11 — Cross-platform production target matrix and platform qualification

**Owner :** QA/Platform · **Taille :** XL · **Dépendances :** CR10, UI15, BR10, FX11, PW11, VO05, QA08, QA09 · **État :** READY_AFTER_RB00

**Critère de sortie :** Windows, macOS, Linux, Android, iOS, Web/PWA and CLI/headless are each classified SUPPORTED, EXPLICITLY_NOT_IN_THIS_RELEASE, or BLOCKED_EXTERNAL; every SUPPORTED target has build + clean-start + core journey evidence tied to the same RC SHA.

**Write scope initial :** `.github/workflows/**`, `packages/desktop/**`, `packages/desktop-electron/**`, `packages/mobile/**`, `packages/app/**`, `packages/unifia/**`, `docs/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### QA12 — Production hardening gate

**Owner :** Release/QA/Security · **Taille :** XL · **Dépendances :** CR10, UI15, BR10, FX11, PW11, VO05, QA02, QA03, QA04, QA05, QA06, QA07, QA08, QA09, QA10, QA11 · **État :** READY_AFTER_RB00

**Critère de sortie :** Full build/test/security/visual/functional/device/platform/package-wiring matrix green on one immutable RC SHA; zero unapproved P0/P1 and zero deceptive production control.

**Write scope initial :** `**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).


### 8-Release

| ID | Lot | Taille | Owner | Dépendances | Issues | État initial |
|---|---|---:|---|---|---|---|
| RL00 | Cut immutable production candidate from qualified new-ui integration | S | Release | QA12 | — | READY_AFTER_RB00 |
| RL01 | Promote RC/new-ui to work-design via reviewed PR | L | Integration | RL00 | — | READY_AFTER_RB00 |
| RL02 | Promote work-design to dev | M | Integration | RL01 | — | READY_AFTER_RB00 |
| RL03 | Promote dev to main | M | Release | RL02 | — | READY_AFTER_RB00 |
| RL04 | Tag/build/sign production release candidate | L | Release | RL03 | — | READY_AFTER_RB00 |
| RL05 | Clean-install smoke on supported production targets | XL | QA | RL04 | — | READY_AFTER_RB00 |
| RL06 | Release notes, known limitations and rollback package | M | Release | RL05 | — | READY_AFTER_RB00 |
| RL07 | Publish production release and post-release canary | M | Release/SRE | RL06 | — | READY_AFTER_RB00 |
| RL08 | Close campaign and archive superseded branches/plans | M | Integration/Docs | RL07 | — | READY_AFTER_RB00 |

#### RL00 — Cut immutable production candidate from qualified new-ui integration

**Owner :** Release · **Taille :** S · **Dépendances :** QA12 · **État :** READY_AFTER_RB00

**Critère de sortie :** Single RC SHA, clean tree, signed baseline record; no feature commits after cut except approved blocker fixes.

**Write scope initial :** `docs/autonomy/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RL01 — Promote RC/new-ui to work-design via reviewed PR

**Owner :** Integration · **Taille :** L · **Dépendances :** RL00 · **État :** READY_AFTER_RB00

**Critère de sortie :** 660+ commit drift is reviewed by domain, CI fully green, tree equivalence proven after merge.

**Write scope initial :** `**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RL02 — Promote work-design to dev

**Owner :** Integration · **Taille :** M · **Dépendances :** RL01 · **État :** READY_AFTER_RB00

**Critère de sortie :** No lost branch-specific fix; protected-branch checks green; tree delta intentional and documented.

**Write scope initial :** `**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RL03 — Promote dev to main

**Owner :** Release · **Taille :** M · **Dépendances :** RL02 · **État :** READY_AFTER_RB00

**Critère de sortie :** Main contains exact qualified product tree plus only approved release metadata.

**Write scope initial :** `**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RL04 — Tag/build/sign production release candidate

**Owner :** Release · **Taille :** L · **Dépendances :** RL03 · **État :** READY_AFTER_RB00

**Critère de sortie :** Desktop/mobile artifacts, checksums, signatures, SBOM and provenance tied to tag SHA.

**Write scope initial :** `.github/workflows/**`, `docs/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RL05 — Clean-install smoke on supported production targets

**Owner :** QA · **Taille :** XL · **Dépendances :** RL04 · **État :** READY_AFTER_RB00

**Critère de sortie :** Install/upgrade/first-run/auth/project/chat/code/work/design/automate/browser/memory/voice applicable journeys pass on clean supported devices.

**Write scope initial :** `docs/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RL06 — Release notes, known limitations and rollback package

**Owner :** Release · **Taille :** M · **Dépendances :** RL05 · **État :** READY_AFTER_RB00

**Critère de sortie :** Checksums exact; only approved deferred limitations listed; rollback path tested and artifacts retained.

**Write scope initial :** `CHANGELOG.md`, `RELEASE_NOTES_TEMPLATE.md`, `docs/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RL07 — Publish production release and post-release canary

**Owner :** Release/SRE · **Taille :** M · **Dépendances :** RL06 · **État :** READY_AFTER_RB00

**Critère de sortie :** Published artifacts match qualified hashes; canary telemetry/crash/support window shows no P0/P1 regression.

**Write scope initial :** `.github/workflows/**`, `docs/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

#### RL08 — Close campaign and archive superseded branches/plans

**Owner :** Integration/Docs · **Taille :** M · **Dépendances :** RL07 · **État :** READY_AFTER_RB00

**Critère de sortie :** Open tasks/issues reconcile to DONE or explicit post-release backlog; stale branches archived; v1.5 retained as historical authority, v2 is execution authority.

**Write scope initial :** `docs/autonomy/**`, `docs/audit/**` (RB00/RB01 doivent le résoudre en chemins exacts avant CLAIMED).

## 6. Gates de programme

| Gate | Conditions |
|---|---|
| REBASELINE-GATE | RB00..RB07 clos ; SHAs figés ; graph de branches et scope approuvés |
| CRITICAL-RUNTIME-GATE | CR10 vert ; aucun P0 runtime reproductible |
| BROWSER-GATE | BR10 vert ; aucune action browser ne contourne authority/network/observation |
| UI-V110-GATE | UI15 vert ; matrice visuelle/responsive/a11y certifiée |
| FUNCTIONAL-CLOSURE-GATE | FX11 vert ; aucun contrôle production factice/no-op |
| PACKAGE-WIRING-GATE | PW11 vert ; classification shipped/not-shipped exacte |
| VOICE-GATE | VO05 vert ; qualification #117 satisfaite ou capacité exclue explicitement du RC |
| PLATFORM-GATE | QA11 vert : matrice Windows/macOS/Linux/Android/iOS/Web-PWA/CLI-headless explicitement qualifiée |
| PROD-HARDENING-GATE | QA12 vert sur un SHA immuable |
| RELEASE-GATE | RL05 vert sur artefacts signés du tag candidat |
| POST-RELEASE-GATE | RL07 canary vert ; rollback prouvé |

## 7. Politique multi-agent

- Une tâche ne passe `CLAIMED` qu’avec `base_sha`, write-set exact, dépendances closes et tests nommés.
- Les mêmes fichiers, lockfile, schémas/SDK, routeurs globaux, authority/policy et workflows de release sont des ressources sérialisées.
- PR ≤ 400 LOC par défaut ; une tâche XL se découpe en slices buildables, jamais en énorme PR monolithique.
- Tout agent doit relire le fichier avant édition ; aucun reset/rebase/force-push destructif sur les branches partagées.
- Une preuve ne ferme un lot que si elle est liée au SHA exact et au consumer réel. Les mocks servent à l’unitaire, pas à certifier un parcours production.

## 8. Stratégie de branches

1. **Ne pas promouvoir directement `new-ui`** tant que QA12 n’est pas vert. Créer une branche RC depuis la baseline RB00.
2. Réconcilier `voice` sur une branche fraîche issue du RC/new-ui courant (VO00→VO05), sans réécrire l’historique partagé.
3. Une fois qualifié : RC/new-ui → `work-design` par PR ; `work-design` → `dev` ; `dev` → `main`, avec preuve d’équivalence d’arbre entre chaque étape.
4. `main` et `dev` sont protégées ; les checks requis doivent tous être inconditionnels sur PR. Une required check filtrée par path est interdite.

## 9. Ce qui est désormais considéré déjà largement livré

- Design : document canonique/workspace, canvas natif, outils vectoriels, layers, commentaires, import legacy ; on ne reconstruit pas cette architecture.
- Memory UI : arborescence, DnD, autosave, actions, graphe local ; le gros restant est le refactor wikilinks et la gouvernance réellement livrée.
- Automate Studio : canvas, library, run bar, persistence, minimap, validations ; le restant critique est dans l’autorité et le runtime d’exécution du graphe, pas dans le chrome.
- Inspecteurs/context panels/Home : les données factices majeures identifiées fin septembre ont été remplacées/retirées selon les audits récents.
- v110 : infrastructure E2E/parity substantielle existe déjà (`packages/app/scripts/parity`, nombreux specs v110). UI00/UI01 doivent la requalifier, pas la remplacer aveuglément.

## 10. Blockers de production actuellement explicites

- Issue #77 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #35 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #86 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #96 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #93 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #97 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #99 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #103 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #118 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #117 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #30 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #33 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #31 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #54 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #55 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #56 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #57 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #58 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.
- Issue #59 — doit être close, supersédée par preuve, ou explicitement sortie du périmètre RC avec décision propriétaire.

## 11. Critère PROGRAM_COMPLETE v2.0

PROGRAM_COMPLETE est vrai uniquement si :

- toutes les gates ci-dessus sont PASS sur une même lignée de release ;
- la release publiée correspond exactement au SHA/artefacts qualifiés ;
- aucun P0/P1 produit connu n’est ouvert ;
- aucune capacité annoncée comme disponible ne dépend d’un package non atteint depuis les shipped roots ;
- le Browser visible est le Browser réellement automatisé ;
- Work/Automate/Memory/Code/Settings n’ont plus de contrôle in-scope sans backend réel ;
- Voice est soit qualifié et intégré, soit explicitement hors release (pas “partiellement présent” sans qualification) ;
- les branches historiques ont été reconciliées/archivées et le rollback de release a été testé.

## 12. Fichiers compagnons

- `TASK-GRAPH-v2.0.json` — registre machine-readable de la campagne.
- `REPO-STATE-2026-09-29.md` — facts de rebaseline utilisés pour construire ce plan.
- `MIGRATION-v1.5-to-v2.0.md` — correspondance des lots historiques.
- `VALIDATION.md` — contrôles mécaniques du dossier.
