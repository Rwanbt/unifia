# CARD DOC01 — Corriger la contradiction de branche par défaut dans `AGENTS.md` (docs seulement)

**But :** `AGENTS.md` dit à la fois « GitHub default branch is `main` » et « The default branch in this repo is `dev` » / « Local `main` ref may not exist ; use `dev` or `origin/dev` for diffs ». Le propriétaire confirme : **`main` est la branche par défaut ; `dev` est la branche d'intégration ; le travail automatisé s'arrête à `dev`.**
**Dépend de :** P0. **Fichiers autorisés :** `AGENTS.md`, `CLAUDE.md` (seulement si la même contradiction y figure), `docs/autonomy/rc0/EXECUTION-LOG.md`. **Branche :** `agent/doc01-default-branch` depuis `origin/dev`. **PR vers `dev`, ≤ 400 lignes.**

## Étapes
1. `grep -n -i "default branch\|origin/dev\|origin/main\|main ref" AGENTS.md CLAUDE.md` ; cite chaque occurrence avec son numéro de ligne.
2. Vérifie : `gh api repos/Rwanbt/unifia --jq .default_branch` doit répondre `main`.
3. Réécris uniquement les phrases contradictoires : `main` = branche par défaut et de production (le propriétaire seul y promeut) ; `dev` = intégration, cible des PR de lots ; les diffs se font contre `origin/dev` pour un lot, contre `origin/main` pour une promotion. **Ne touche à aucune autre règle.**
4. Ajoute une seule phrase : « Les agents ne poussent jamais sur `main` et ne tagguent pas de release. »

## Preuves / STOP
`git diff --stat` (uniquement des fichiers `.md`) ; `bunx biome check` non applicable. **STOP** si `gh` ne confirme pas `main`.
