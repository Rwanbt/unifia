# Migration v2.0 → v2.2 (RC-0)

Le v2.0 reste l'archive normative (`v2.0-archive/`). Le v2.2 change **l'ordre, le périmètre par train et le point d'arrêt du travail automatisé** (`dev`), pas l'objectif : tout est câblé, train par train.

- Tâches v2.0 : 97 · v2.2 : 104 (+7).
- Répartition par train : train 1 = 53, train 2 = 28, train 3 = 23.
- Tâches `owner_only` : RL03, RL04, RL05, RL06, RL07, P0.

## Tâches nouvelles

| ID | Train | Taille | Lot |
|---|---:|---:|---|
| VO06 | 2 | XL | Voice completion: Pocket Android TTS, AEC/APM chain (G9), Android streaming STT (NDK), endurance G12, Bluetooth routes |
| QA13 | 1 | L | Platform qualification lite: Windows, Linux, Android (build + clean start + core journeys on RC SHA) |
| QA12R | 1 | L | Release-1 gate on one immutable dev SHA: CI/security/functional/voice/platform |
| R2 | 2 | XL | Train 2 gate: everything on dev, ready for the owner manual tests (Browser, Work/Automate/Code/Settings closure, Voice completion) |
| R3 | 3 | L | Train 3 gate: full program on dev, ready for the owner manual tests and release |
| QA14 | 1 | L | Release pipeline audit: no release channel; neutralize inherited upstream targets; review side effects of pushes to dev |
| P0 | 1 | M | One-time sync of dev to the frozen new-ui baseline (dev is an ancestor of new-ui) - OWNER-EXECUTED |

## Tâches modifiées (champs)

| ID | Champs modifiés |
|---|---|
| RB02 | acceptance |
| RB05 | title |
| CR01 | dependencies |
| CR02 | dependencies |
| CR03 | dependencies |
| CR06 | dependencies |
| CR07 | dependencies |
| CR08 | dependencies |
| CR09 | dependencies |
| UI00 | title, dependencies, acceptance |
| FX01 | dependencies |
| PW01 | dependencies |
| VO01 | dependencies |
| VO02 | title, acceptance |
| VO04 | title, acceptance |
| QA00 | dependencies |
| QA01 | dependencies |
| QA02 | dependencies |
| QA03 | dependencies |
| QA04 | dependencies |
| QA05 | dependencies |
| QA06 | dependencies |
| QA09 | dependencies |
| QA11 | dependencies |
| QA12 | dependencies |
| RL00 | title, dependencies, acceptance |
| RL01 | title, size, acceptance |
| RL02 | title, dependencies, size |
| RL03 | title, dependencies, acceptance |
| RL04 | title |
| RL05 | title |
| RL06 | title |
| RL07 | title |
| RL08 | title |

## Correspondance des décisions

| v2.0 | v2.2 |
|---|---|
| CR03 `OWNER_DECISION` | Tranché (D1 = A, step-up). La fusion reste au propriétaire. |
| BR00–BR10, UI12 | Train 2 (Browser masqué en release 1). |
| UI00–UI15 | UI00 = vérification (train 1) ; UI01/UI02 train 2 ; UI03–UI11 et UI13–UI15 train 3, seulement si UI00 trouve des slices OPEN. |
| VO00–VO05 | Train 1, périmètre Voice borné ; VO06 (nouveau, train 2) porte le reste de G0–G14. |
| PW00, PW01 | Train 1. PW02, PW04–PW07, PW09 train 2. PW03, PW08, PW10, PW11 train 3. |
| FX00, FX01 | Train 1. FX02–FX07 train 2. FX08–FX11 train 3. |
| QA11, QA12 | Train 3 (matrice complète). QA13 et QA12R les remplacent pour le train 1. |
| RL00–RL08 | RL00–RL02 côté agent (sur `dev`) ; RL03–RL07 réservés au propriétaire ; plus de canal beta. |
| Promotion `new-ui → work-design → dev → main` | P0 (synchronisation unique `dev` ← `new-ui`, propriétaire) ; lots en PR ≤ 400 lignes vers `dev` ; `dev` → `main` par le propriétaire seul. |

## Corrections des versions précédentes du pack

1. **v2.1 → v2.2 : plus de bêta.** La v2.1 supposait un canal beta et une tâche QA14 « création du canal beta ». Le propriétaire choisit des releases directes : QA14 devient un audit du pipeline de release.
2. **`beta.yml`** ne peut pas servir de canal (il synchronise des PR étiquetées, planificateur désactivé) ; `publish.yml` sur la branche `beta` viserait `anomalyco/opencode-beta`. Ni l'un ni l'autre n'est utilisé.
3. **Branche par défaut :** confirmée `main` par le propriétaire ; `AGENTS.md` se contredit (carte DOC01).
4. **Effets de bord de `dev` :** ajoutés (D10, O5) après lecture des workflows déclenchés par un push sur `dev`.
