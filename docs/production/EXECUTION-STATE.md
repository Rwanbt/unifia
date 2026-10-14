<!-- SPDX-License-Identifier: MIT -->
# État d'exécution — point de reprise

Mise à jour : 2026-10-13, 23 h 30 UTC.

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

Vérifié le 13 octobre à 22 h 25 UTC, après #657 (`main → dev`, `ebb4d906a`) et #659 (`dev → dev_auto`, `e1e525337`).

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

**Blocage connu (#664).** Dans le cloud, `bun install` échoue sur `ghostty-web`. Bun télécharge cette dépendance `github:` par l'API GitHub, et le proxy cloud ne sert les dépôts tiers que par `git`. Tant que #664 n'est pas tranchée :
- une session cloud ne peut lancer ni typecheck ni test en local ;
- la CI sur le SHA de tête de la PR fait la vérification ;
- chaque PR le dit dans « How did you verify ».

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

## Arbitrage des branches du 13 octobre

| Branche | Décision | Suite |
|---|---|---|
| `fix/rc1-design-visual-identity` | reprise | #583 |
| `fix/rc1-package-wiring-policy` | reprise | #584 (`.github/**`) |
| `fix/rc1-workspace-tabs-551` | reprise, avec correction du sélecteur `Close` du test Automate | #591 rouverte |
| `fix/rc1-home-glance-550` | reprise, avec traduction de l'état du serveur | #592 rouverte |
| `fix/browser-bun-node-e2e-279` | reprise, comme fondation Browser hors interface (D2) | #593 rouverte (`.github/**`) |
| `docs/plan-global-20261013` | reprise, marquée comme instantané daté | #651 rouverte |
| `docs/rc1-scope-policy-548` | conservée en brouillon, en attente de ratification | #660 |
| `fix/rc1-code-diff-588` | code repris sur `dev` | #663, puis branche à supprimer |
| `automation/fix-486-dialog-lifecycle-20261013` | code repris sur `dev` | #661, puis branche à supprimer |
| `automation/e2e-480-composer-toggle-20261013` | code repris sur `dev` | #662, puis branche à supprimer |
| `automation/fix-493-default-memory-containment-20261013` | déjà couverte par #520, fusionnée | branche à supprimer |
| `plan/rc1-scope-freeze-548` | remplacée par #660, qui en reprend deux règles | branche à supprimer |

Les commits des branches à supprimer restent accessibles par leurs PR fermées (#582, #589, #590) ou par les PR qui les reprennent.

## En attente du propriétaire

- **Suppression de branches.** Le classifieur des sessions cloud la refuse. Le Claude Code local la fait, branche par branche, une fois la PR de reprise fusionnée :

  ```sh
  git push origin --delete <branche>
  ```

- **#660.** Trois ratifications de périmètre : Code Lens et Inline AI (#96), le choix implémenter ou retirer pour `home.glance`, les onglets de workspace et `code.diff`, et le rattachement de chaque contrôle SOON à une issue.
- **#664.** Le choix d'une option pour `ghostty-web` dans le cloud.

## Règles de clôture

- **Aucune fusion avec un check rouge ou bloqué** sans explication écrite sur la PR.
- **Aucune issue fermée sans preuve.** Il faut le SHA de fusion et une observation du point d'entrée réellement livré. Un code présent, un composant dormant ou une CI partiellement verte ne suffit pas.
