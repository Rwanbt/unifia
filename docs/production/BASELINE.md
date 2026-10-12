<!-- SPDX-License-Identifier: MIT -->
# Baseline de production — Unifia

Point de départ de la qualification. Chaque fait porte le SHA où il a été observé. Un fait sans SHA n'est pas une preuve.

| Référence | SHA | Observé le |
|---|---|---|
| `dev` (tête) | `2d2e2146c9` | 2026-10-11 (après fusion de #465) |
| `main` (gelée) | `207ff452b8` | 2026-10-11 |
| `dev` avant la session | `da892e07e9` | 2026-10-11 (#462) |

`main` n'est pas modifiée. Les PR qui visent `main` (#426, #435, #437) restent gelées.

## Fusionné dans `dev` pendant la session

| PR | Objet | SHA de fusion |
|---|---|---|
| #455 | Refus des requêtes adressées à un autre nom d'hôte sans identifiants | `9207c7f636` |
| #458 | Une signature Windows ignorée n'apparaît plus comme un succès | `a8de8351b1` |
| #460 | Origines de confiance exactes, refus cross-origin, écoute réseau refusée sans mot de passe | `85be34b131` |
| #462 | Vérification de la signature de l'installeur, échec si `required` et non signé | `da892e07e9` |
| #465 | Documentation : `unifia web` n'est pas un proxy de développement | `2d2e2146c9` |

## Ouvert à la date de la baseline

| PR | Base | État | Tête | Objet |
|---|---|---|---|---|
| #464 | dev | prête, CI en cours | `aca300d1a0` | Le CLI lit le coffre du serveur (ADR-090) |
| #456 | dev | brouillon, non fusionnable | `a1b7ce345a` | Panneau mémoire sur les routes gouvernées (22 fichiers, +1814/−128) |
| #433 | dev | brouillon | `34b5d3fbbc` | Drapeau de signeur Tauri |
| #432 | dev | brouillon | `7775b20840` | Verdict voix unique |
| #428 | dev | prête | `3bc8273dfd` | Documentation RC-0 |
| #437, #435, #426 | main | brouillons, gelées | — | Hors périmètre (ordre de l'autorité : `main` gelée) |

## Contextes requis sur `dev`

Observés dans les vérifications de fusion de la session : `unit (linux)`, `unit (windows)`, `rust unit tests`, `check-compliance`, `check-standards`, `conformance`, `sdk in sync with server`. `typecheck` et `web-build` sont également verts sur les PR récentes, sans être confirmés comme requis. `check-duplicates` n'est pas requis sur `dev`. `e2e (linux)` n'est pas requis sur `dev`, mais il tourne sur chaque PR.

Source : vérifications `gh pr checks` et réglages de protection observés pendant la session. À reconfirmer par `gh api repos/Rwanbt/unifia/branches/dev/protection` avant toute décision de fusion.

## Ce que la baseline ne prouve pas

- Aucune suite de tests n'a été exécutée sur l'ensemble de `dev` pour cette baseline. `TEST-INVENTORY.json` compte des fichiers, il ne compte pas des résultats.
- Les E2E navigateur de la mémoire ne passent pas sur la branche de #456 (voir GAP-REGISTER).
- Aucune candidate Windows ni chaîne Android n'a été construite dans cette session.
