<!-- SPDX-License-Identifier: MIT -->
# État d'exécution — point de reprise

Mise à jour : 2026-10-11. Ce fichier est le point de reprise. Une reprise doit partir d'ici, du dépôt et des PR, pas de la mémoire de la conversation.

## Où en est le travail

- Phase courante : A (reprise et sécurisation de l'existant). Les étapes B à F ne sont pas commencées.
- Branche de cette baseline : `docs/production-baseline`, depuis `dev` `2d2e2146c9`.
- `main` : `207ff452b8`, gelée. Aucune fusion vers `main`, aucune publication.

## Cartes

| Carte | Statut | SHA | PR | Preuve |
|---|---|---|---|---|
| Garde d'hôte (#455) | IMPLEMENTED, INTEGRATED sur `dev` | `9207c7f636` | #455 | `git merge-base --is-ancestor` vérifié |
| Politique d'origine (#460) | INTEGRATED sur `dev` | `85be34b131` | #460 | idem |
| Signature Windows silencieuse (#458) | INTEGRATED sur `dev` | `a8de8351b1` | #458 | idem |
| Vérification de signature (#462) | INTEGRATED sur `dev`, mode `required` non branché sur la release | `da892e07e9` | #462 | idem |
| Documentation `unifia web` (#465) | INTEGRATED sur `dev` | `2d2e2146c9` | #465 | fusion squash |
| CLI lit le coffre du serveur (ADR-090) | IMPLEMENTED, TESTED localement, CI en cours | `aca300d1a0` | #464 | `bun test test/knowledge/cli` 22/22 ; fichier `cli-process` 11/11 en mode source |
| Panneau mémoire sur routes gouvernées | IMPLEMENTED sur sa branche, NON fusionnable | `a1b7ce345a` | #456 | voir GAP-REGISTER G-01 |
| Baseline de production | IMPLEMENTED (cette PR) | à la fusion | à créer | `docs/production/` |

## Blocages

- **Dossiers racine du vault** (`OpenCode/`, `Seno/`) : le déplacement a été refusé par le classificateur (« destruction locale irréversible »). Décision requise de l'utilisateur. Aucune contournement n'a été tenté.
- **Vault, lint** : 4 erreurs bloquantes restantes sur 6 (voir GAP-REGISTER G-02).
- **CI de #464** : `unit (linux)` vert ; `unit (windows)` et `e2e (linux)` en cours au moment de la baseline. Le suivi automatique est actif.

## Décisions prises pendant la session

- ADR-090 : le CLI lit le coffre que lit le serveur (`.unifia/memory` ou `memory.directory`). La garde de confinement est partagée (`server/knowledge-authority.ts`).
- Le lien d'issue d'une PR vers `dev` s'écrit `Closes #N`. La règle `linked-issue.mjs` n'accepte pas `Refs`. Sur une base `dev`, GitHub ne ferme pas l'issue à la fusion.

## Prochaine action exécutable

1. Lire la CI de #464. Si `unit (windows)` et `e2e (linux)` sont verts sur `aca300d1a0`, fusionner avec `--match-head-commit aca300d1a0` après contrôle des contextes requis.
2. Découper #456 : rebaser la branche sur `dev` après #464, puis répartir en tranches de 400 lignes au plus (voir GAP-REGISTER G-01).
3. Rédiger l'ADR D1 (identité locale). Le code la tient déjà : `decideOwner` n'accorde rien sans principal admin.

## Ce qui n'est pas dans cette baseline

- Les travaux Android, la candidate Windows et la qualification native : non commencés. Voir PLATFORM-SUPPORT.
- Les tests des domaines Browser, Voice, Automate, Team, Work, Design : non analysés. Voir CAPABILITY-MATRIX.
