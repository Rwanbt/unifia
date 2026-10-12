# CARD P0 — Synchronisation unique `dev` ← `new-ui` — EXÉCUTÉE PAR LE PROPRIÉTAIRE

**But :** faire de `dev` la branche d'intégration unique, au SHA de baseline figé par RB00. Après P0, tous les lots des agents sont des PR ≤ 400 lignes vers `dev`. Aucun agent n'exécute cette carte.
**Pré-requis :** RB00 (SHA figé), RB02 (`PROMOTION-MAP.md`), RB03 (mesure de baseline) faits ; tu as répondu aux deux questions de `PROMOTION-MAP.md` (A ou B ; effets de bord acceptés ou non).

## Avant de synchroniser
1. Note les SHA de retour arrière : `git rev-parse origin/dev origin/main` (observé le 29/09 : `dev` = `9535064…`, `main` = `207ff45…`).
2. Vérifie l'ascendance : `git merge-base --is-ancestor origin/dev <SHA_BASELINE> && echo OK`. Si ce n'est pas `OK`, **arrête-toi**.
3. Décide des effets de bord (voir `PROMOTION-MAP.md`) : `containers.yml` va pousser des images vers `ghcr.io/<toi>` ; `generate.yml` va pousser un commit bot vers `dev`. Si tu ne veux pas l'un des deux, désactive le workflow concerné **avant** la synchronisation (`gh workflow disable <nom>` ou modification dédiée), puis réactive-le après.

## Option A — PR de promotion
1. `git push origin <SHA_BASELINE>:refs/heads/promote/new-ui-baseline`
2. Ouvre la PR `promote/new-ui-baseline` → `dev`. L'exemption du gate de taille doit être en place (changement de `scripts/check-pr-size.sh` ou de `work-design-integrity.yml`, PR séparée, relue par toi).
3. Fusionne en **merge commit** (pas de squash : l'historique de 1457 commits serait perdu).

## Option B — poussée directe avec contournement
`git push origin <SHA_BASELINE>:dev` (fast-forward ; demande le droit de contournement des règles de branche).

## Après
1. `git fetch origin && git merge-base --is-ancestor <SHA_BASELINE> origin/dev && echo P0-OK`.
2. `git diff --stat <SHA_BASELINE> origin/dev` doit être vide, à l'exception des commits bot (`generate.yml`).
3. Surveille les runs sur `dev` (CI, `typecheck`, `codeql`, `generate`, `containers`). Note tout échec dans `EXECUTION-LOG.md`.
4. Dis à l'agent « P0 fait » : il vérifie lui-même avec la commande de l'étape 1, puis démarre les lots.

## Retour arrière
Remettre `dev` à l'ancien SHA exige un push forcé : **toi seul**, avec contournement, et seulement si un effet de bord grave l'impose. Les images `ghcr.io` déjà poussées ne se retirent pas automatiquement.
