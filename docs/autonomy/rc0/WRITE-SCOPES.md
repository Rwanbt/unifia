<!-- SPDX-License-Identifier: MIT -->
# WRITE-SCOPES — périmètres de fichiers (carte RB01, partie 2)

**Statut : PARTIEL, par conception.** Résoudre les 50+ tâches du train 1 d'un coup produirait des listes périmées dès le premier merge (la baseline bouge : commits bot de `generate.yml`). Chaque tâche résout donc son périmètre **au moment du claim**, avec :

```
git ls-files '<glob de la tâche dans TASK-GRAPH-RC0.json>'
git grep -l '<symbole racine>'   # appelants
```
et consigne la liste dans sa ligne `CLAIMED` du journal, avec `base_sha = origin/dev`.

## Ressources sérialisées (un seul agent à la fois — conflit garanti sinon)
`bun.lock` · `packages/sdk/**` et `packages/sdk/openapi.json` (régénérés par `./script/generate.ts`, contrôlés par le check requis « sdk in sync with server ») · `packages/contracts/**` · routeurs globaux du serveur · autorité/politiques (`packages/workbench-server`, capacités) · `.github/workflows/**` · fichiers i18n `packages/app/src/i18n/*.ts` (17 locales, parité auditée).
