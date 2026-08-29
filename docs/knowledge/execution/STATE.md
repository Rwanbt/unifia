# STATE — Sovereign Knowledge Core V1 (append-only)

> Append-only. Chaque carte ajoute une nouvelle entrée. Ne jamais réécrire une
> entrée passée ; pour amender, ajouter une nouvelle entrée référençant
> l'ancienne. Hash, commandes, durées et statuts sont obligatoires.

## Carte 0000 — Démarrage et création de l'état durable

- **ID** : 0000
- **Phase** : démarrage
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Préflight** : `git rev-parse --show-toplevel` = `D:/App/unifia/unifia-memory`,
  branche = `feat/sovereign-knowledge-core`, HEAD = `95350647140a382ee6d5d61bc2f6639597d80f0b`,
  working tree clean, remote = vide, worktree `work-design` séparé.
- **Fichiers créés** : `docs/knowledge/`, `docs/knowledge/execution/`,
  `docs/knowledge/execution/{blockers,checkpoints,evidence}/`,
  `tests/knowledge/eval/{dev,holdout}/`, `docs/knowledge/execution/BASELINE.md`.
- **Prochaine carte** : 0001 — P-1.1 corpus de cas réels.
- **Risque** : aucun à ce stade. Documentation honnête du scope, pas
  d'implémentation.

---

## Carte 0001 — P-1.1 : Corpus de cas réels et motivation

- **ID** : 0001
- **Phase** : -1 (Prouver le besoin)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/WHY-NOT-VAULT-RG-GIT.md` et `docs/knowledge/PRODUCT-CASES.md`
- **Sources** : `docs/KNOWN_FAILURE_PATTERNS.md` (207 lignes, ≥ 14 incidents),
  `CHANGELOG.md` (reb rand), `docs/KNOWN_ISSUES.md` (A.1..A.11, B.1..B.A6, S2.A1..S1.V2).
- **Cas livrés** : 10 (PC-01..PC-10), chacun avec tâche / workflow / échec /
  contexte requis / contexte interdit / comportement V1 / preuve.
- **Mapping capability ↔ cas** : complet dans `PRODUCT-CASES.md` §"Mapping".
- **Preuve** : `git ls-files` des 2 documents, présence dans
  `docs/knowledge/`. Aucun cas inventé, tous ancrés sur le repo
  ou les ADR.
- **Carte suivante** : 0002 — P-1.2.

---

## Carte 0002 — P-1.2 : Golden dataset dev/holdout

- **ID** : 0002
- **Phase** : -1
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `tests/knowledge/eval/{dev,holdout}/`
- **Fixtures** : 11 dev, 11 holdout, UUIDv7 simulés préfixes
  `0190d2c0-7b00-7000-8000` (dev) et `0190d2c0-7b00-7000-9000` (holdout).
- **Couverture** : types `decision`, `failure`, `constraint`,
  `episodic`, `semantic`, `reference` (FR) ; lifecycle `active` /
  `superseded` ; restrictions `remote_model: deny|allow`,
  `local_model: allow` ; langues FR + EN.
- **Script** : `tests/knowledge/eval/check-isolation.ts`
  - vérifie unicité des IDs par side,
  - détecte les IDs partagés entre dev/holdout,
  - détecte les 5-grams partagés entre fixtures (≥ 5 mots
    normalisés).
- **Commande** : `bun tests/knowledge/eval/check-isolation.ts`
- **Résultat** : `[OK] dev=11 fixtures, holdout=11 fixtures, no shared
  ids, no shared 5-grams.` exit 0.
- **Itération** : 1 reformulation nécessaire (3+2 5-grams partagés dans
  la signature "Provenance: known failure pattern" des fixtures
  bash, corrigés).
- **Carte suivante** : 0003 — P-1.3.

---

## Carte 0003 — P-1.3 : Definition of Done V1

- **ID** : 0003
- **Phase** : -1
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/SOVEREIGN-CORE-V1-DOD.md`
- **Contenu** :
  - 12 exigences user-level (U-01..U-12) avec oracle / commande /
    preuve / owner.
  - 10 exigences engineering-level (E-01..E-10) avec la même grille.
  - Aucun item "vérifier manuellement" sans procédure.
- **Gate P-1** : rempli (≥ 5 cas réels, mapping complet, dev/holdout
  valides, DoD testable).
- **Carte suivante** : 0010 — P0.1 baseline et cartographie.

---

## Phase 0 — gel de la réalité

## Carte 0010 — P0.1 : Baseline + cartographie

- **ID** : 0010
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/execution/MODULE-MAP.md`
- **Périmètre cartographié** : Project, Session, storage, tools,
  filesystem, Git, MCP, providers/fallback, event bus, Work, Design,
  Tauri desktop, Tauri mobile, ONNX/llama, ai-native-dev-stack,
  memory-governance/runtime, contracts. 17 composants.
- **Statut dominant** :
  - REUSE : Project (partiel), Session (partiel), storage, providers,
    event bus, Tauri desktop, Tauri mobile, ai-native-dev-stack (8).
  - ADAPT : Project (côté knowledge ref), Session (branchement),
    tools (DataClassification), filesystem (ResolvedKnowledgePath),
    git (KnowledgeGitProvider wrap), MCP (capabilities knowledge),
    Work (adaptateur), Design (adaptateur), ONNX/llama
    (EmbeddingProvider), memory-governance/runtime (mapping
    candidat), contracts (ajout knowledge/) (10).
  - REPLACE : aucun.
  - DEPRECATE : aucun.
- **Preuve** : `docs/knowledge/execution/MODULE-MAP.md` (~15 kB).
  Aucun composant n'est marqué REPLACE, validant la North Star
  Rule "sans dette technique volontaire".
- **Carte suivante** : 0017 — P0.8 (ADR + estimation).

---

## Carte 0011 — P0.2 : Spike NativeKnowledgePort

- **ID** : 0011
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0012 — P0.3 : Spike filesystem

- **ID** : 0012
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0013 — P0.4 : Spike sandbox

- **ID** : 0013
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0014 — P0.5 : Spike SQLite/FTS

- **ID** : 0014
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0015 — P0.6 : Spike embeddings Android

- **ID** : 0015
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0016 — P0.7 : Spike Git

- **ID** : 0016
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0017 — P0.8 : ADRs + estimation

- **ID** : 0017
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : 9 ADR + estimation.
- **ADR livrés** (tous ACCEPTED) :
  1. `0001-knowledge-identity.md` — UUIDv7, locator, version hash.
  2. `0002-knowledge-canonical.md` — Markdown + YAML frontmatter.
  3. `0003-knowledge-class-b.md` — Portable metadata copy-on-write.
  4. `0004-knowledge-class-c.md` — Local control state, jamais Git/vault.
  5. `0005-knowledge-class-d.md` — Derived state, reconstructible.
  6. `0006-knowledge-egress.md` — Default deny, UNCLASSIFIED = DENY EXTERNAL.
  7. `0007-knowledge-native-port.md` — TS/Rust split, toutes requêtes bornées.
  8. `0008-knowledge-search.md` — FTS5 d'abord, vector ensuite, ANN différé.
  9. `0009-knowledge-lifecycle.md` — candidate/active/superseded/archived.
- **Aucun champ "TBD"**. Chaque ADR suit le format Contexte /
  Décision / Alternatives rejetées / Conséquences / Validation.
- **Estimation** : `docs/knowledge/execution/ESTIMATION.md`.
  - Total phases 1-11 hors environnement : ~50.75 JH.
  - Avec multiplicateurs Android et aléas : ~60-70 JH.
- **Cohérence avec les ADR pré-existants** : KNOW-0001 à 0009
  référencent et respectent ADR 1026 (ExportProjection boundary),
  1027 (local install secret), 1028 (local auth ownership),
  1029 (queue ordering), 1030 (migration rollback), 1031
  (legacy telemetry), 1032 (phase 3 content optin). Aucun
  conflit.
- **Carte suivante** : checkpoint Phase 0 ; Phase 1.1 dans une
  session ultérieure.

---

## Checkpoint Phase 0 — Récapitulatif

**Date** : 2026-08-29.

**Cartes livrées** :

- 0000 — Préflight + état durable.
- 0001 — P-1.1 corpus de cas réels (10 cas, PC-01..PC-10).
- 0002 — P-1.2 golden dataset (11 dev + 11 holdout, isolation
  vérifiée par `check-isolation.ts`).
- 0003 — P-1.3 DoD (12 user-level + 10 engineering-level).
- 0010 — P0.1 cartographie (17 composants, statut REUSE/ADAPT).
- 0017 — P0.8 ADRs (9 ADR Knowledge) + estimation (~50-70 JH).

**Cartes Phase 0 non exécutées dans cette session** :

- 0011 — P0.2 Spike NativeKnowledgePort.
- 0012 — P0.3 Spike filesystem.
- 0013 — P0.4 Spike sandbox.
- 0014 — P0.5 Spike SQLite/FTS.
- 0015 — P0.6 Spike embeddings Android.
- 0016 — P0.7 Spike Git.

Ces cartes requièrent soit un device Android, soit des builds
Rust sur la machine (cargo + mémoire), soit des opérations de
filesystem concurrente, et sont mieux exécutées dans des
sessions consacrées avec isolation des ressources.

**Commit** : voir `git log -3 --oneline` après la prochaine étape.

**Reprise** : prochaine session ouvre `docs/knowledge/execution/STATE.md`,
lit le dernier checkpoint, et reprend à la première carte non PASS.
