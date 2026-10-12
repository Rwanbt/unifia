# CARD RB00 — Figer la baseline d'implémentation (taille S, lecture seule + 1 fichier doc)

**But :** enregistrer les SHA immuables des 5 branches et l'`IMPLEMENTATION_BASELINE_SHA`. Aucune tâche ne peut être `READY` sur une baseline mouvante.
**Agent :** n'importe lequel. **Décision globale déléguée :** aucune.
**Fichier autorisé (écriture) :** `docs/autonomy/rc0/BASELINE-RC0.md` (nouveau) et `docs/autonomy/rc0/EXECUTION-LOG.md` (ajout). **Rien d'autre.**

## Étapes
1. `git status --porcelain` → doit être vide. Sinon **STOP** et rapporte (ne rien nettoyer).
2. `git fetch origin --prune`
3. Pour chaque branche `b` dans `new-ui work-design voice dev main` : `git rev-parse origin/$b`
4. Ancêtres : `git merge-base --is-ancestor origin/work-design origin/new-ui && echo OK` ; idem pour `origin/dev` et `origin/main`.
5. Divergences (gauche = seulement dans `new-ui`, droite = seulement dans la branche) : `git rev-list --left-right --count origin/new-ui...origin/$b` pour chaque branche.
6. Branche par défaut : `gh api repos/Rwanbt/unifia --jq .default_branch`. Attendu : `main` (confirmé par le propriétaire). Si `gh` est absent : note « non vérifié ». Si le résultat n'est pas `main` : **STOP**.
7. Protection de `new-ui` : `gh api repos/Rwanbt/unifia/branches/new-ui/protection` (404 = non protégée). **Ne modifie rien.**
8. Écris `BASELINE-RC0.md` avec : date/heure, tableau branche→SHA complet, relation (ancêtre/divergente + compteurs), branche par défaut (`main`), état de protection de `new-ui`, et la ligne exacte `IMPLEMENTATION_BASELINE_SHA=<SHA complet de origin/new-ui>`.

## Preuves attendues
Sorties brutes des commandes 3 à 7 collées dans le fichier. Comparaison avec les valeurs observées le 29/09 (`new-ui` 2c13b7d…, work-design 609f2d4…, voice f3f7f03…, dev 9535064…, main 207ff45…) : liste les écarts, ne les « corrige » pas.

## Checkpoint
Commit local `docs(autonomy): freeze rc0 baseline`. Pas de push sans feu vert.

## STOP si
Worktree sale ; `work-design`, `dev` ou `main` a des commits absents de `new-ui` (l'hypothèse D8 est alors fausse : rapporte, ne continue pas RB02).
