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
- **Statut** : _à remplir_
- **Cible** : `docs/knowledge/execution/BASELINE.md` (déjà créé carte 0000),
  cartographie par `git ls-files` + inventaire des modules centraux.
- **Action** : (suite, prochaine session possible)

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
- **Statut** : _à remplir_
- **Cible** : 9 ADR à `docs/knowledge/adr/0001..0009-knowledge-*.md`.
