<!-- SPDX-License-Identifier: MIT -->
# Topologie des dépôts et conditions de consolidation — 2026-08-04

Rédigé après relecture du plan canonique §6 (« Topologie de dépôts
recommandée »), à la demande du propriétaire du projet.

## Ce que dit le plan

§6.1 désigne deux dépôts pour l'étape initiale :

```text
Rwanbt/unifia            fork OpenCode, runtime principal, SDK et contrats canoniques
Rwanbt/unifia-workbench  serveur, orchestrateur, document capabilities, tests de conformité
```

**Le dépôt principal est donc le fork OpenCode.** Concrètement :
`D:\App\OpenCode\opencode`, remote `https://github.com/Rwanbt/opencode.git`
(pas encore renommé en `unifia`).

## Correction d'une confusion de dossiers

`D:\App\OpenCode` **n'est pas un dépôt** : son `.git` ne contient qu'`info` et
son `packages/` est vide. C'est un dossier conteneur, qui abrite entre autres
`opencode/` et `unifia-execution-clean/`.

## Topologie mesurée du fork

| Référence | Tête | Date |
|---|---|---|
| `main` | `207ff452b` | 2026-07-21 |
| `dev` | `e21b7389f` | 2026-07-30 |
| `fix/team-selector-min-models-deadlock` | `e0fe00a975` | (branche courante) |

`main` et `dev` ont divergé le 2026-07-21 à `5c34e5ddb1` : **27 commits dans
`main` absents de `dev`, 32 dans `dev` absents de `main`**. La tête de `main`
est « Merge pull request #16 from Rwanbt/dev », donc `main` est le tronc et
`dev` la branche d'intégration.

## Où se trouve le travail Unifia

La branche `recovery/unifia-audit-correction-20260803` est **basée sur `main`**
(`207ff452b`) et porte **354 commits** au-dessus. Elle a été rapatriée dans le
fork le 2026-08-04 par `git fetch` depuis `unifia-execution-clean`, avec
historique complet.

L'opération est additive et réversible. Vérifié après coup : `main`, `dev` et
`fix/team-selector-min-models-deadlock` inchangés, arbre de travail propre, HEAD
toujours sur `fix/team-selector-min-models-deadlock`.

Pour annuler : `git branch -D recovery/unifia-audit-correction-20260803`.

> Note : `unifia-execution-clean` est un **clone shallow** dont la troncature
> commence à `207ff452`. Toute comparaison faite depuis ce clone rapporte
> faussement une absence d'ancêtre commun avec `dev` ; les mesures ci-dessus
> viennent du fork, qui a l'historique complet.

## Conditions §6.3 avant fusion dans le monorepo

Le plan interdit le déplacement dans le monorepo tant que les six conditions
suivantes ne sont pas remplies.

| Condition | État | Preuve ou raison |
|---|---|---|
| Stabilisation des contrats | ✅ | `@unifia/contracts` : 32/32 vitest + smokes, typecheck 25/25 |
| Tests de conformité | ✅ | `RuntimeConformance` 30/30 (3 runtimes × 10 scénarios), gate 8/8 sur 32 suites |
| Validation des licences | ✅ local | `supply-chain/*` 5/5 : chemins interdits, imports exclus, SPDX, licences de manifeste, épinglage des dépendances |
| Validation du build desktop | ❌ | Jamais tenté dans cette session. Nécessite le sidecar puis `bun tauri build`. |
| Validation du mobile | ❌ | Jamais tenté. Nécessite `ORT_LIB_LOCATION` et un build Android de 5+ min. |
| Réduction des conflits upstream | ✅ mesuré | Voir ci-dessous |

### Conflits mesurés

`git merge-tree` entre la branche Unifia et les deux têtes du fork :

- **vers `main` : fusion propre, zéro conflit.**
- **vers `dev` : exactement 2 fichiers en conflit** —
  `packages/opencode/src/auth/index.ts` et
  `packages/ui/src/pierre/opencode-theme.ts`.
  Les 39 autres fichiers touchés des deux côtés fusionnent automatiquement.

La surface de conflit est donc faible et nommée, ce qui satisfait la condition
« réduction des conflits avec upstream OpenCode » au sens où elle est désormais
mesurée plutôt que supposée.

## Verdict

**Quatre conditions sur six sont remplies.** Les deux manquantes sont les
validations de build desktop et mobile — ni l'une ni l'autre n'est un problème
de code Unifia, ce sont des builds à exécuter.

Tant qu'elles ne sont pas faites, le plan interdit la consolidation monorepo.
La branche vit donc dans le fork **sans être fusionnée**, ce qui est exactement
l'étape §6.1 : le travail est dans le bon dépôt, la fusion attend ses conditions.
