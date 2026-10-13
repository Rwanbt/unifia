<!-- SPDX-License-Identifier: MIT -->
# État d'exécution — point de reprise

Mise à jour : 2026-10-13 au soir.

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

Le 13 octobre au soir, `dev` ⊂ `dev_auto` était vérifié. En revanche, `main` porte deux commits que `dev` n'a pas encore (#655 et #547). La PR #657 les ramène sur `dev`.

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

**Limites d'une session cloud :**
- pas de Windows, d'Android ni de GPU ;
- espace disque limité ;
- aucun script de démarrage n'installe Bun ni les dépendances.

Une session cloud convient au code TypeScript, aux tests Linux, à la CI et à la documentation.

### Label `lane:auto`

Une issue reçoit `lane:auto` seulement si elle remplit toutes ces conditions :
- elle tient en une PR de 400 lignes au plus ;
- elle ne touche ni `.github/**`, ni l'authentification, ni les secrets ou la sécurité ;
- elle ne comporte ni migration de données ni décision d'architecture ;
- elle se vérifie avec la CI existante.

C'est le propriétaire ou Claude qui pose le label. Première sélection : #480 (réactivation des E2E ignorés, groupe par groupe) et #56 (tests Windows instables).

## File d'exécution

La file ordonnée est la section « Immediate execution order » de l'épique #581. Si ce fichier et #581 divergent, #581 l'emporte.

**Gouvernance CI** (#545, #546, QA10) :
- déjà fusionnées : #544, #547, #655 et #656 ;
- reste #657.

Il faudra ensuite constater, sur la prochaine PR vers `dev` ou `dev_auto`, que les labels `needs:issue` et `check-duplicates` ne s'affichent plus à tort, avant de fermer #545 et #546.

## En attente du propriétaire

- **#657** (`main → dev`) : elle touche `.github/**`, donc sa fusion revient au propriétaire (D11).
- **Branches distantes** : leur suppression est refusée aux sessions cloud. Elle passe par le Claude Code local du propriétaire.

## Branches temporaires à disposer

Ces branches ont des commits propres, mais leur PR a été fermée sans fusion. Elles appartiennent au travail de ChatGPT, qui doit décider pour chacune : rouvrir la PR vers `dev_auto`, ou supprimer la branche après vérification.

- `automation/e2e-480-composer-toggle-20261013`
- `automation/fix-486-dialog-lifecycle-20261013`
- `automation/fix-493-default-memory-containment-20261013`
- `fix/browser-bun-node-e2e-279`
- `fix/rc1-code-diff-588`
- `fix/rc1-home-glance-550`
- `fix/rc1-workspace-tabs-551`
- `plan/rc1-scope-freeze-548`

Ces branches ont encore une PR ouverte :
- `docs/plan-global-20261013` (#651) ;
- `fix/rc1-design-visual-identity` (#583) ;
- `fix/rc1-package-wiring-policy` (#584).

## Règles de clôture

- **Aucune fusion avec un check rouge ou bloqué** sans explication écrite sur la PR.
- **Aucune issue fermée sans preuve.** Il faut le SHA de fusion et une observation du point d'entrée réellement livré. Un code présent, un composant dormant ou une CI partiellement verte ne suffit pas.
