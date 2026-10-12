<!-- SPDX-License-Identifier: MIT -->
# État d'exécution — point de reprise

Mise à jour : 2026-10-11, après fusion de #473 (`0369a8618c`) et #472 (`baa20b3774`). Ce fichier est le point de reprise : une reprise part d'ici, du dépôt et des PR, pas de la conversation.

## Branche de référence

- `dev` : `0369a8618c` (tête au moment de la mise à jour).
- `main` : `207ff452b8`, gelée. Aucune fusion vers `main`, aucune publication.

## Fusionné dans `dev` pendant la session

| PR | Objet | SHA de fusion |
|---|---|---|
| #455 | Garde d'hôte sans identifiants | `9207c7f636` |
| #458 | Signature Windows ignorée non silencieuse | `a8de8351b1` |
| #460 | Politique d'origine exacte | `85be34b131` |
| #462 | Vérification de signature Windows | `da892e07e9` |
| #465 | Documentation `unifia web` | `2d2e2146c9` |
| #464 | CLI lit le coffre du serveur (ADR-090) | `0603191057` |
| #468 | Baseline `docs/production/` | `3e0a146930` |
| #471 | Arborescence gouvernée et façade (tranche 1 de #456) | `8b64635524` |
| #472 | Doctor et audit propriétaire (tranche 2) | `baa20b3774` |
| #473 | Harnais E2E : origine de confiance et amorçage du serveur | `0369a8618c` |

## Ouvert

| PR | Objet | État au moment de la mise à jour |
|---|---|---|
| #476 | Routes `/note`, `/links`, `/propose` (tranche 2b de #456) | CI en cours |
| #477 | Client de connaissance pour l'application (tranche 3) | CI en cours |
| #479 | Vérification Basic : mot de passe avec `:`, comparaison à temps constant | CI en cours |
| #475 | Compte d'appels de l'espion `Npm.install` par répertoire | CI en cours |
| #456 | Panneau mémoire, source des tranches restantes | Brouillon, à découper |
| #474, #478, #470, #469 | Issues de suivi | Ouvertes |

## Preuves établies

- E2E complet du CI sur `f7c6dedc5c` (PR #473) : 263 réussies, 0 échouée, 51 ignorées, 17,4 min. Source : log du job `e2e (linux)` de `38138549287`.
- Cause racine de l'E2E rouge sur `dev` : depuis #460, le backend isolé refusait l'origine de la page de test (`403 untrusted-origin`), chaque test attendait un délai, et le job atteignait les 110 minutes. Preuve : `curl` avec `Origin` contre un backend sans `--cors`, et le run `dev` `38102295462` arrêté par le délai.
- Défaut d'authentification Basic : `split(":")` refusait tout mot de passe contenant `:`. Preuve : test de régression `basic-auth-owner.test.ts` (commit `cb9f9c522e`, #479).

## Exclusions E2E

Registre complet : `docs/production/E2E-SKIP-REGISTER.md`. 28 exclusions conditionnées à la CI (groupe A), 10 `fixme` (groupe B), et des conditions de configuration (groupe C). Aucune réactivation n'est encore faite.

## Vault

- Lint : 2 erreurs bloquantes restantes sur 6, toutes deux `unexpected-root-directory` (`OpenCode/`, `Seno/`). Les frontmatter manquants et la session sont corrigés en place. Les dossiers ne sont pas déplacés, conformément au mandat. Sauvegarde vérifiée : `D:\App\vault-backup-2026-10-11`.

## Décisions prises pendant la session

- ADR-090 : le CLI lit le coffre du serveur (`.unifia/memory` ou `memory.directory`).
- Le lien d'issue d'une PR vers `dev` s'écrit `Closes #N` ; GitHub ne ferme l'issue qu'après une fusion sur `main`.
- Le harnais E2E déclare à son backend isolé l'origine exacte de la page de test, sans en ajouter d'autre. La politique d'origine du serveur est inchangée.
- Une exclusion `fixme` est une décision de périmètre à trancher avec le propriétaire, pas une correction.

## Prochaine action exécutable

1. Fusionner #476, puis #477 quand leur CI est verte, sur SHA exact.
2. Découper la tranche 4 de #456 (vault tree et écritures) après #477, puis la tranche 5 (panneau).
3. Ouvrir une issue par groupe A et réactiver chaque test par PR, avec preuve CI.
4. Décision de périmètre sur les `fixme` du groupe B.
5. Régler le groupe C (agents, variantes, partage, baselines Linux).
6. D1 : ADR d'identité locale. Le code est déjà correct sur la règle (aucun propriétaire sans admin vérifié). D2 et D3 restent à faire.
