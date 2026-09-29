# CARD RB02 — Carte de divergence, plan de synchronisation P0 et effets de bord de `dev` (taille M, lecture seule + 1 fichier doc)

**But :** prouver l'ascendance des branches, préparer la décision D10 (synchronisation unique `dev` ← `new-ui`), lister les **checks requis** et les **effets de bord d'un push sur `dev`**.
**Dépend de :** RB00. **Fichier autorisé :** `docs/autonomy/rc0/PROMOTION-MAP.md` (nouveau), `EXECUTION-LOG.md` (ajout). Aucun changement de workflow ou de script dans cette carte.
**Décision déléguée :** aucune. Tu présentes ; le propriétaire tranche.

## Contexte
Le travail automatisé s'arrête à `dev` ; le propriétaire seul promeut `dev` → `main` (D9). `dev` doit d'abord devenir la branche d'intégration unique : c'est la synchronisation P0, exécutée par le propriétaire.

## Étapes
1. Reprends les sorties de `BASELINE-RC0.md`. Confirme `work-design`, `dev`, `main` ⊂ `new-ui` (0 commit propre). Sinon **STOP**.
2. Mesure le delta : `git diff --shortstat origin/dev origin/new-ui` ; `git diff --name-only origin/dev origin/new-ui | wc -l` (attendu ≈ 2410 fichiers) ; `git diff --numstat origin/dev origin/new-ui | awk '{a+=$1;d+=$2} END{print a+d}'` (approximation : ne retire pas lockfiles ni dossiers générés). Ne lance pas `check-pr-size.sh` : il compare l'arbre de travail courant à `dev`.
3. Gate de taille : lis en entier `.github/workflows/work-design-integrity.yml` (PR vers `dev`, exécute `bash scripts/check-pr-size.sh dev`) et `scripts/check-pr-size.sh` (échoue au-delà de **400 lignes modifiées**, hors lockfiles et `dist|build|target|generated`). Cite les lignes clés.
4. Checks requis : `gh api repos/Rwanbt/unifia/branches/dev/protection/required_status_checks` puis idem pour `main`. Liste chaque contexte. Note lesquels sont filtrés par chemins (le plan interdit un check requis conditionné par chemin). Note si le contournement de règles (bypass) est possible pour le propriétaire.
5. **Effets de bord d'un push sur `dev`.** Pour chaque workflow déclenché par `push` sur `dev` (`grep -n -A6 "^  push:" .github/workflows/*.yml`), calcule s'il se déclenche pour le delta de l'étape 2 (filtres `paths`) et ce qu'il fait :
   - `containers.yml` : filtre `packages/containers/**`, `.github/workflows/containers.yml`, `package.json` ; construit et **pousse des images** vers `ghcr.io/<propriétaire>` (`--push`). Attendu : **se déclenche** (3 fichiers `packages/containers/` et `package.json` changent).
   - `generate.yml` : sans filtre ; régénère et **pousse un commit bot** vers `dev`.
   - `nix-hashes.yml` : lis ses `paths` ; peut pousser un commit de retour.
   - `release-github-action.yml` : filtre `github/**` (attendu : ne se déclenche pas).
   - `publish.yml` : lis chaque job ; le job `version` est gardé par `github.repository == 'anomalyco/opencode'` ; vérifie les autres jobs (`needs`, `if`).
   - `android.yml`, `typecheck.yml`, `test.yml`, `codeql.yml`, `storybook.yml`, `nix-eval.yml`, `voice-ci.yml` : note s'ils publient quelque chose.
   Sortie : tableau workflow → se déclenche ? → effet sortant (image, commit, release, aucun).
6. Options pour P0 (à présenter, pas à implémenter) :
   - **A** : PR de promotion en *merge commit*, avec exemption explicite et versionnée du gate de taille pour ce type de PR (par ex. branche de tête `promote/*`), relue par le propriétaire.
   - **B** : le propriétaire pousse le SHA figé sur `dev` avec contournement de règle (`git push origin <SHA>:dev`, fast-forward puisque `dev` est ancêtre).
   - **C** : tranches ≤ 400 lignes — écartée (≈ 2410 fichiers) ; documente pourquoi.
   Ne recommande pas le *squash* : il effacerait l'historique de 1457 commits.
7. Écris `PROMOTION-MAP.md` : ascendance prouvée (sorties brutes), mesure du delta, checks requis, tableau des effets de bord, options A/B/C, SHA de rollback (`dev` et `main` avant P0), et **deux questions au propriétaire** : (1) A ou B ? (2) accepte-t-il les effets de bord (images `ghcr.io`, commits bot) ?
8. Ajoute la liste des exigences de **fin de cycle** : promotion `dev` → `main` = PR du propriétaire, checks requis verts, tag `vX.Y.Z` par le propriétaire.

## Preuves attendues
Sorties de commandes brutes, citations `fichier:ligne`.

## Checkpoint / STOP
Commit local `docs(autonomy): map dev sync and side effects`. **STOP** si `gh` est indisponible pour les checks requis : note « non vérifié » et demande l'export au propriétaire.
