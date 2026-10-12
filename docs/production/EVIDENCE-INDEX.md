<!-- SPDX-License-Identifier: MIT -->
# Index des preuves

Chaque preuve indique le SHA auquel elle s'applique et la commande pour la refaire. Une preuve sans SHA ne ferme aucun écart. Une preuve locale n'est pas une preuve CI.

| ID | Affirmation | SHA | Commande | Résultat | Type |
|---|---|---|---|---|---|
| E-01 | #455, #458, #460 et #462 sont ancêtres de `origin/dev` | `da892e07e9` (tête de `dev` à ce moment) | `git merge-base --is-ancestor <sha> origin/dev` pour `9207c7f636`, `a8de8351b1`, `85be34b131`, `da892e07e9` | Les quatre sont ancêtres | Vérifié (Git) |
| E-02 | #465 fusionnée | `2d2e2146c9` | `gh pr view 465 --json state,mergeCommit` | `MERGED`, merge `2d2e2146c9` | Vérifié (GitHub) |
| E-03 | Le CLI lit le coffre du serveur : 22 tests verts | `aca300d1a0` (état de travail au moment du test) | `cd packages/unifia && bun test test/knowledge/cli --timeout 30000` | 22 pass, 0 fail | Local, pas la CI |
| E-04 | Le fichier de test des processus réels passe en mode source : 11 tests | `aca300d1a0` | `cd packages/unifia && bun test test/knowledge/e2e/cli-process.test.ts` | 11 pass, 0 fail (mode source, pas le binaire construit) | Local, pas la CI |
| E-05 | Les deux échecs unitaires de #464 venaient du run `38106047751` (head `448ae70dd1`) | `448ae70dd1` | `gh api repos/Rwanbt/unifia/actions/jobs/114371695620/logs` (linux) et `.../114371695581` (windows) | Tests `cli-process` et `search` (chemin Windows) | CI, lu dans les logs |
| E-06 | `unit (linux)` de #464 est vert sur `aca300d1a0` | `aca300d1a0` | `gh pr checks 464` | pass | CI |
| E-07 | `merge-and-size` de #464 passe sur `aca300d1a0` | `aca300d1a0` | `gh api repos/Rwanbt/unifia/actions/runs/38108198412/jobs` | `Check card size` = success | CI (voir G-14) |
| E-08 | Lint du vault : 6 erreurs bloquantes avant correction, 4 après | non applicable (vault Obsidian, hors dépôt) | `python _system/tooling/vault.py --root <vault> lint` | exit 1, 4 lignes bloquantes | Outil du vault |
| E-09 | Sauvegarde des dossiers racine du vault | non applicable | comparaison SHA-256 de `OpenCode/` et `Seno/` | 4/4 et 1/1 fichiers, empreintes identiques | Vérifié (hors dépôt) |
| E-10 | Comptage des fichiers de test par zone | `2d2e2146c9` | commande dans `TEST-INVENTORY.json` (champ `method`) | 1296 fichiers, 117 specs E2E | Comptage, aucune exécution |

## Ce qui n'a pas de preuve

- Aucune suite complète n'a été exécutée sur `dev` pour cette baseline.
- Le binaire construit (`bun run build --single`) n'a pas été exécuté localement sur `aca300d1a0`.
- Aucune signature, aucune candidate Windows, aucun build Android.
