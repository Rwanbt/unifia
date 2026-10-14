<!-- SPDX-License-Identifier: MIT -->
# État d'exécution — point de reprise

Mise à jour : 2026-10-14, après la fusion de #669 (`8a7a113d8`), #670 (`ad2736e68`) et #660 (`b3f443a46`) dans `dev`.

Branches distantes au moment de cette mise à jour : `main`, `dev`, `dev_auto`, et les branches des PR encore ouvertes (#671 synchro, #673 contrôles grisés). Aucune autre.

C'est le point de départ de toute session : Claude Code sur le PC du propriétaire ou dans le cloud, et la boucle ChatGPT. Une reprise part d'ici, du dépôt et des PR, jamais de la conversation.

L'ordre d'autorité des documents se trouve dans `CLAUDE.md`, section « Unifia Workbench Context ». Il vaut pour tous les agents.

## Branches

Trois branches sont permanentes. Toutes les autres sont temporaires : on les supprime après intégration, une fois vérifié qu'elles n'ont aucun commit propre. Les règles détaillées sont dans `AGENTS.md`, section « Branches ».

| Branche | Rôle |
|---|---|
| `main` | production, protégée ; seul le propriétaire y fusionne (D9) |
| `dev` | intégration, protégée ; cible des PR de fonctionnalité et de correction |
| `dev_auto` | IA autonomes ; resynchronisée depuis `dev` avant chaque cycle |

L'invariant à tenir est `main` ⊂ `dev` ⊂ `dev_auto`. Pour le vérifier :

```sh
git fetch origin
git merge-base --is-ancestor origin/main origin/dev && echo "main ⊂ dev"
git merge-base --is-ancestor origin/dev origin/dev_auto && echo "dev ⊂ dev_auto"
```

Vérifié le 14 octobre : `main` (`0d9539cad`) ⊂ `dev` (`b3f443a46`). `dev_auto` (`e1185dce6`) ne contient pas encore `dev` : la synchro #671 le rétablit. Après chaque lot fusionné dans `dev`, cette synchro est refaite avec un commit de fusion.

## Décisions en vigueur

**Branches.** `main`, `dev` et `dev_auto` sont permanentes (décision du propriétaire du 12 octobre, inscrite dans #597).

**Release 1** (décisions de `docs/autonomy/rc0/DECISIONS.md`) :
- elle vise Windows, Linux et Android (D5) ;
- Browser est livré après la release 1 (D2) ;
- la parité visuelle est atteinte : seuls les correctifs de régression constatés sont prévus (D6, reconfirmé le 13 octobre).

**Fusions vers `dev`.** Les agents fusionnent dans `dev`, sauf :
- les changements de `.github/**` ;
- CR03 ;
- P0.

Ces trois cas reviennent au propriétaire (D11).

**Réservé au propriétaire (D9).** L'automatisation s'arrête à `dev`. La promotion `dev → main`, les tags, la signature et la publication sont faits par le propriétaire seul.

## Voies de travail

| Voie | Qui | Cible | Périmètre |
|---|---|---|---|
| `dev` | Claude Code (PC ou cloud), propriétaire | PR courtes vers `dev` | la file de #581, la sécurité, le câblage des packages |
| `dev_auto` | boucle ChatGPT planifiée | PR vers `dev_auto` | issues étiquetées `lane:auto` uniquement |
| PC du propriétaire | Claude Code local | `dev` | builds desktop et Android, GPU, tests physiques, qualification voix et plateformes |

### Session cloud

Le hook `.claude/hooks/session-start.sh` s'exécute au démarrage de chaque session Claude Code cloud. Il installe la version de Bun fixée par `package.json`, puis lance `bun install`, comme l'action `setup-bun` de la CI. Sur le PC du propriétaire, il ne fait rien.

**ghostty-web (#664) : résolu.** Le paquet `ghostty-web` est embarqué dans `packages/ghostty-web` (`@unifia/ghostty-web`, en `workspace:*`) par #669 (`8a7a113d8`). Le 14 octobre, le hook de démarrage a lancé `bun install` avec succès dans une session cloud (`Checked 2834 installs across 2702 packages`), et #664 est fermée avec cette preuve. Les deux essais précédents avaient échoué sur un disque de session saturé, pas sur le dépôt.

Ce qui reste vrai dans une session cloud :
- les tests se lancent en local, mais Windows, Android et GPU restent vérifiés par la CI ou sur le PC du propriétaire ;
- chaque PR précise dans « How did you verify » ce qui a été vérifié en local et ce qui vient de la CI.

**Autres limites :**
- pas de Windows, d'Android ni de GPU ;
- espace disque limité.

Une session cloud convient au code TypeScript, aux tests Linux, à la CI et à la documentation.

**PC du propriétaire.** `.claude/settings.json` et `.claude/hooks/` sont désormais suivis par git. Si ton clone local a un `.claude/settings.json` non suivi, renomme-le en `.claude/settings.local.json` avant de tirer `dev`. Ce fichier reste ignoré et prime sur le réglage partagé.

### Descriptions de PR

Le workflow `compliance-close` ferme automatiquement, après 2 heures, toute PR qui porte le label `needs:compliance`. Le 13 octobre, il a fermé sans revue #582, #589 à #593 et #651. Pour l'éviter, la description doit reprendre `.github/pull_request_template.md` avec :
- les cinq titres `### Issue for this PR`, `### Type of change`, `### What does this PR do?`, `### How did you verify your code works?` et `### Checklist` ;
- au moins une case `[x]` sous « Type of change » ;
- au moins deux cases `[x]` sous « Checklist ».

Une PR fermée par ce bot n'a pas été rejetée : il suffit de corriger la description et de la rouvrir.

### Label `lane:auto`

Une issue reçoit `lane:auto` seulement si elle remplit toutes ces conditions :
- elle tient en une PR de 400 lignes au plus ;
- elle ne touche ni `.github/**`, ni l'authentification, ni les secrets ou la sécurité ;
- elle ne comporte ni migration de données ni décision d'architecture ;
- elle se vérifie avec la CI existante.

C'est le propriétaire ou Claude qui pose le label. Première sélection : #480 (réactivation des E2E ignorés, groupe par groupe) et #56 (tests Windows instables).

## File d'exécution

La file ordonnée est la section « Immediate execution order » de l'épique #581. Si ce fichier et #581 divergent, #581 l'emporte.

**Gouvernance CI** (#545, #546, QA10) : terminée. #544, #547, #655, #656, #657 et #659 sont fusionnées, et #545 et #546 sont fermées.

## Arbitrage des branches (13 et 14 octobre)

| Branche | Décision | Suite |
|---|---|---|
| `fix/rc1-design-visual-identity` | reprise | #583, fusionnée |
| `fix/rc1-package-wiring-policy` | reprise | #584, fusionnée (`.github/**`) |
| `fix/rc1-workspace-tabs-551` | reprise, avec correction du sélecteur `Close` du test Automate | #591, fusionnée |
| `fix/rc1-home-glance-550` | reprise, avec traduction de l'état du serveur | #592, fusionnée |
| `fix/browser-bun-node-e2e-279` | reprise, comme fondation Browser hors interface (D2) | #593, fusionnée (`.github/**`) |
| `docs/plan-global-20261013` | reprise, marquée comme instantané daté | #651, fusionnée |
| `docs/rc1-scope-policy-548` | décisions du 14/10 inscrites dans le périmètre | #660, fusionnée (`b3f443a46`) ; branche absente du dépôt |
| `fix/rc1-code-diff-588` | code repris sur `dev` | #663, fusionnée ; branche absente du dépôt le 14/10 |
| `automation/fix-486-dialog-lifecycle-20261013` | code repris sur `dev` | #661, fusionnée ; branche absente du dépôt le 14/10 |
| `automation/e2e-480-composer-toggle-20261013` | code repris sur `dev` | #662, fusionnée ; branche absente du dépôt le 14/10 |
| `automation/fix-493-default-memory-containment-20261013` | couverte par #520 (`9f11886a8`) | branche absente du dépôt le 14/10 |
| `plan/rc1-scope-freeze-548` | remplacée par #660, qui en reprend deux règles | branche absente du dépôt le 14/10 |
| `fix/home-glance-wait` | remplacée | branche absente du dépôt le 14/10 |
| `fix/vendor-ghostty-web-664` | embarquement du paquet ghostty-web | #669, fusionnée (`8a7a113d8`) ; branche absente du dépôt |

Les commits des branches absentes du dépôt restent accessibles par leurs PR fermées (#582, #589, #590) ou par les PR qui les reprennent.

## En attente du propriétaire

- **Contrôles grisés, rattachement (#548).** L'inventaire est dans `docs/production/CONTROLS-GREYED-RC1.md` (#673). À décider : créer des issues post-RC1 pour les fonctions grisées, ou les garder dans la file RC-1. Et `aria-disabled` ou `disabled` pour le terminal et le Work.
- **#548 reste ouvert.** Il manque l'inventaire des contrôles actifs, des routes 503 et des `disabled` sans marqueur « bientôt ».
- **`nix-hashes` (#669).** Ce workflow est désactivé manuellement depuis le 29/09. Après #669, `nix/hashes.json` est périmé : les builds Nix de `node_modules` échoueront jusqu'à son recalcul. À décider : le réactiver, ou recalculer les hashes autrement.
- **#279 (Browser).** Choix de l'option de runtime : hôte Node, client CDP sur Bun, ou compatibilité Bun/Playwright suivie en CI.

## Règles de clôture

- **Aucune fusion avec un check rouge ou bloqué** sans explication écrite sur la PR.
- **Aucune issue fermée sans preuve.** Il faut le SHA de fusion et une observation du point d'entrée réellement livré. Un code présent, un composant dormant ou une CI partiellement verte ne suffit pas.
