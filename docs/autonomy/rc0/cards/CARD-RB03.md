# CARD RB03 — Baseline propre build/tests/conformance (taille L, mesure seulement)

**But :** mesurer l'état réel de `new-ui` sur une branche RC propre. **On mesure, on ne corrige pas.** Chaque échec est classé (préexistant / flaky connu / régression) avec ses logs.
**Dépend de :** RB00, RB02. **Fichier autorisé :** `docs/autonomy/rc0/BASELINE-RUN.md` (nouveau), `EXECUTION-LOG.md` (ajout). Les artefacts de build et de cache restent **non commités**.

## Étapes
1. Crée la branche locale RC depuis le SHA de RB00 : `git switch -c rc/baseline <IMPLEMENTATION_BASELINE_SHA>` (nom exact à valider avant création ; ne touche pas au checkout de référence).
2. `bun install --frozen-lockfile` — note le résultat.
3. `bun run typecheck` — résultat par paquet.
4. `node scripts/check-package-wiring.mjs` — attendu : 25 paquets atteints, 27 déclarés non livrés.
5. Gates : `node scripts/check-workbench-security.mjs` ; `node scripts/check-workbench-test-boundary.mjs` ; `node scripts/check-capability-lease-parity.mjs` ; `node scripts/unifia-conformance.mjs` (lis d'abord son en-tête pour les options).
6. Tests : `bun run --cwd packages/workbench-server test` ; `bun run test:unifia` ; `bun run --cwd packages/app test:unit`.
7. E2E : `bun run --cwd packages/app test:e2e` seulement si l'environnement le permet ; sinon note « non exécuté » et la raison. Ne réessaie pas en boucle.
8. Pour chaque échec : nom du test, extrait de log, classification. Croise avec les issues connues : #56, #57 (flakes unit), #58 (flakes E2E), #55 (fail-fast Turbo qui masque des échecs).
9. Écris `BASELINE-RUN.md` : tableau commande → résultat → durée → classification. Distingue local vs CI.

## Preuve « PR-backed »
Le critère de sortie RB03 exige qu'un candidat sur PR exécute tous les checks requis (le vert local ne suffit pas). Cette preuve viendra naturellement des PR vers `dev` après la synchronisation P0. D'ici là, RB03 reste `PARTIEL` : la mesure locale est valide, la preuve CI ne l'est pas. **Ne pousse ni ne crée de PR sans feu vert du propriétaire.**

## STOP si
`bun install` échoue (réseau/registre) : rapporte, ne contourne pas ; plus de 20 % de tests en échec sans classification possible.
