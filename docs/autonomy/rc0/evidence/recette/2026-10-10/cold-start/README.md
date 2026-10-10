<!-- SPDX-License-Identifier: MIT -->
# Démarrages à froid du lanceur E2E : résultats bruts

**Date :** 2026-10-10. **Commande :** `bun script/e2e-local.ts -- e2e/files/file-open.spec.ts --retries=0` (un processus par run, un démarrage de serveur par run).
**Logs :** `logs/`, copies brutes du terminal.

Ce dossier ne donne aucune conclusion sur la cause. Il conserve ce qui a été observé. La classification est à faire à partir de ces logs.

## Séries

| Série | Run | Code de sortie | Résultat Playwright | Observation dans le log | Fichier |
|---|---|---|---|---|---|
| A (avant nettoyage) | 1 | 1 | 1 failed | `expect.poll` dans `waitSession` (`actions.ts:542`) : la page de session n'est pas atteinte dans le délai | `coldstart-1.log` |
| A | 2 | 9 | aucun décompte | le serveur s'arrête après le chargement de la configuration, aucune erreur de test écrite. Cause de la sortie 9 non établie | `coldstart-2.log` |
| A | 3 | 1 | 1 failed | Vite : `FATAL ERROR: Committing semi space failed. Allocation failed`, puis `ERR_CONNECTION_REFUSED` sur `page.goto` | `coldstart-3.log` |
| B (après nettoyage) | 1 | 0 | 1 passed (34.3 s) | | `cold2-1.log` |
| B | 2 | 0 | 1 passed (29.5 s) | | `cold2-2.log` |
| B | 3 | 0 | 1 passed (36.4 s) | | `cold2-3.log` |

## Premier run isolé (avant la série A)

`e2e-fileopen-alone.log` (hors de ce dossier, session de travail) : 10 tests, 1 échec au premier test avec `TypeError: Failed to fetch dynamically imported module: .../src/pages/session.tsx`, puis 9 réussis. Sortie 1. Le log n'a pas été copié ici.

## Conditions de machine relevées

- Avant nettoyage : 104 processus `node`/`bun` vivants, dont 85 orphelins lancés depuis nos worktrees (serveurs LSP `biome` et serveurs unifia dont le parent avait disparu). Ils ont été arrêtés. Les processus MCP et Codex n'ont pas été touchés.
- Après nettoyage (série B) : 19 à 23 processus `node`/`bun`. Mémoire virtuelle libre : 8,0 à 8,1 Go sur 32 Go.
- Le processus `PioneerGame` (hors projet) occupait 3,4 Go, puis 5 Go plus tard dans la journée. Il n'a pas été touché.

## Ce que ces données établissent, et ce qu'elles n'établissent pas

- Établi : sur 3 runs avant nettoyage, 3 défaillances différentes (délai `waitSession`, sortie 9, échec d'allocation Vite). Sur 3 runs après nettoyage, 0 défaillance.
- Non établi : que le nettoyage soit la cause. Trois runs contre trois n'est pas un échantillon suffisant. La corrélation avec le nombre de processus et la mémoire est un indice.
- Non établi : l'origine de la sortie 9 et de l'erreur `Failed to fetch dynamically imported module`.
- Le même type de délai `waitSession` apparaît sur la base `dev` (`sidebar-session-links`, run du 2026-10-10). L'échec n'est donc pas propre à une branche.

## Runs clavier (sidebar) : base et #441

Voir `logs/kbd-base-*.log` et `logs/kbd-after-*.log`. Sur la base `dev` : 3 runs sur 3, les 2 tests passent à chaque run. Sur #441 avec `<Index>` : 3 runs sur 3, le test clavier échoue. Ce résultat concerne la conception `<Index>`, remplacée depuis.
