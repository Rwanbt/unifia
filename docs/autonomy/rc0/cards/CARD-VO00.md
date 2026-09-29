# CARD VO00 — Geler la divergence voice/new-ui et la stratégie d'intégration (taille M, lecture seule)

**But :** classer les 20 commits propres de `voice` et les 42 commits de `new-ui` absents de `voice`, prédire les conflits, fixer la stratégie. **Aucune fusion dans cette carte.**
**Dépend de :** RB02. **Fichiers autorisés :** `docs/autonomy/rc0/VOICE-DIVERGENCE.md` (nouveau), `EXECUTION-LOG.md`. (La doc d'état voice vit sur la branche `voice` : `docs/operations/voice-v2-autonomous-state.md`. **Ne la modifie pas ici.**)

## Étapes
1. `git fetch origin voice new-ui` ; `MB=$(git merge-base origin/voice origin/new-ui)` ; note `$MB`.
2. Commits propres de voice : `git log --oneline --no-merges origin/new-ui..origin/voice` (attendu ≈ 20). Classe chacun : `voice-core`, `audio natif Android`, `providers STT/TTS`, `CI voice-ci`, `docs/ADR`, `autre`.
3. Commits de new-ui absents de voice : `git log --oneline --no-merges origin/voice..origin/new-ui` (attendu ≈ 42). Classe : `touche des fichiers voice`, `partagé (app/contracts/…)`, `sans rapport`.
4. Fichiers touchés des deux côtés : `comm -12 <(git diff --name-only $MB origin/voice | sort) <(git diff --name-only $MB origin/new-ui | sort)`.
5. Prédiction de conflits sans toucher au worktree : `git merge-tree --write-tree origin/new-ui origin/voice` ; note le code de sortie et la liste des `CONFLICT`.
6. Écris `VOICE-DIVERGENCE.md` : tableaux de classement, liste des fichiers en conflit prévisible, et **stratégie recommandée** : nouvelle branche `integration/voice-on-dev` créée depuis `origin/dev` **après P0** (`dev` = baseline), `git merge origin/voice` (jamais de rebase, jamais de force-push), résolution sémantique des conflits, puis tests partagés de l'app, puis PR(s) vers `dev` ≤ 400 lignes par tranche (l'intégration se découpe par domaine, jamais en une PR monolithique).
7. Rappelle le périmètre Voice de la release 1 (voir `DECISIONS.md` D3) : Live Android (Oboe, Silero, Smart Turn, STT final Parakeet), chemin desktop Windows, TTS système Android comme repli étiqueté. Tout le reste = VO06 (train 2).

## Attention
La doc voice indique que le checkout de référence de la branche est un worktree sur la machine du propriétaire ; tu n'y as pas accès. Travaille uniquement à partir de `origin/voice`.

## STOP si
`merge-tree` signale des conflits dans `packages/contracts/**` ou `packages/sdk/**` : ce sont des ressources sérialisées ; rapporte avant toute intégration.
