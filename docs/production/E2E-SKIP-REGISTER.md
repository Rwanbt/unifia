<!-- SPDX-License-Identifier: MIT -->
# Registre des tests E2E exclus

Base : `dev` `0369a8618c` (après #473). Source : `playwright test --list` avec `CI=1` (liste des annotations `skip` et `fixme` sans exécution), complétée par l'inspection des sites de `test.skip(...)` conditionnés à l'exécution. Le run CI de #473 a compté 263 réussies, 51 ignorées, 0 échouée.

Groupes : **A** instables, à stabiliser puis réactiver ; **B** fonctionnalité absente, à implémenter si dans le périmètre ; **C** conditions de configuration, à corriger ou à justifier.

Les 39 tests annotés statiquement sont listés ci-dessous. Les exclusions conditionnées à l'exécution (18 sites) sont listées par site. Le décompte exact des 51 par run est à confirmer par le log CI de chaque run : c'est la preuve de référence.

## Groupe A — instables (conditionnés à `CI`)

| Fichier | Tests | Raison actuelle | Capacité testée | Fonctionnalité existe ? | Pertinence plateforme | Correctif nécessaire | Priorité |
|---|---|---|---|---|---|---|---|
| `session/session-composer-dock.spec.ts` | 13 (dock, questions bloquées, permissions allow once/reject/always, dock enfant, todo, focus clavier) | « aria-pressed attribute race on shared runners » | Flux de questions et permissions bloquant le composer | Oui (dock présent) | Élevée : sécurité des permissions | Attendre l'état committé (`aria-pressed`) par `expect.poll` au lieu d'un clic immédiat ; cause à confirmer | P1 |
| `settings/settings-keybinds.spec.ts` | 8 (raccourcis sidebar, terminal, paramètres, nouvelle session, fichier, palette, réinitialisation, effacement) | « waitTerminalFocusIdle exceeds 90s » | Édition et persistance des raccourcis | Oui | Moyenne | Cause réelle à établir : le helper attend un terminal focus idle qui n'arrive pas en CI | P2 |
| `status/status-popover.spec.ts` | 7 (ouverture, onglets compute/lsp/mcp/plugins, fermeture) | « tab switch timing race » | Popover d'état et ses onglets | Oui | Moyenne | Attendre l'onglet actif par état applicatif, pas par délai | P2 |

## Groupe B — fonctionnalité absente (`fixme`)

| Fichier | Test | Capacité | Fonctionnalité existe ? | Constat | Décision de périmètre | Priorité |
|---|---|---|---|---|---|---|
| `v110/home-glance.spec.ts` (×3) | cellules `home.glance`, valeurs numériques, rayon | Tableau de bord d'accueil | Non : « never implemented » (`docs/audit/RC0-V110-PARITY-ANCHORS.md`) | Présent dans le contrat v110 déclaré, absent du code | À trancher : implémenter ou retirer du contrat v110 (décision produit documentée) | P2 |
| `v110/a4-code-chrome.spec.ts`, `v110/shell.spec.ts`, `v110/responsive.spec.ts` | barre d'onglets de workspace (`shell.workspace-tabs`) | Onglets de workspace | Composant `WorkspaceTabsBar` existe, aucun point de rendu | Déclaré, non branché | À trancher : brancher le composant ou acter son retrait | P2 |
| `v110/code.spec.ts` | `code.diff` | Diff mobile | Composant `MobileDiff` existe, aucun point de rendu | Déclaré, non branché | À trancher comme ci-dessus | P2 |
| `models/model-picker.spec.ts` | « smoke model selection updates prompt footer » | Sélection de modèle | Oui | Fixme sans cause documentée | Diagnostiquer : sans doute le même défaut de sélecteur que le groupe A | P2 |
| `prompt/prompt-history.spec.ts` | historique shell séparé | Historique du prompt | Partiel | Fixme sans cause documentée | Diagnostiquer | P3 |
| `session/session-review.spec.ts` | scroll de la revue après mise à jour du diff en direct | Revue de session | Oui | Fixme sans cause documentée | Diagnostiquer | P2 |

## Groupe C — conditions de configuration

| Fichier | Site | Condition actuelle | Constat | Correctif | Priorité |
|---|---|---|---|---|---|
| `design/design-visual.spec.ts` (10 tests de régression visuelle, 8 viewports + 2 rechargements) | `test.skip(!updating && !existsSync(baseline))` | Aucune baseline Linux | Les baselines existent pour `win32` seulement | Générer les baselines Linux dans un job CI contrôlé et les committer (ne jamais écrire la baseline à partir du run jugé) | P2 |
| `prompt/prompt-footer-focus.spec.ts` (2) | `test.skip(!next, "only one agent / one model available")` | Un seul agent ou modèle dans le backend de test | Le fournisseur `e2e` expose `test-model` et `review-model` mais un seul agent | Ajouter un second agent dans la configuration de test | P2 |
| `session/session-model-persistence.spec.ts` (2) | `test.skip(!name / !other ...)` | Pas de variantes d'agent ni d'autre agent | Même cause que ci-dessus | Idem | P2 |
| `thinking-level.spec.ts` (1) | `test.skip(!exists, "current model has no variants")` | Le modèle de test n'a pas de variantes | Configuration de test | Déclarer une variante dans le fournisseur `e2e` | P3 |
| `prompt/prompt-slash-share.spec.ts`, `session/session.spec.ts` (2) | `test.skip(shareDisabled)` (`UNIFIA_DISABLE_SHARE`) | Partage désactivé dans l'environnement de test | Le partage est une fonctionnalité supportée | Activer le partage dans le backend de test, ou justifier par une fonctionnalité non supportée sur la plateforme | P2 |
| `settings/settings.spec.ts` (1) | `test.skip(true, "auto-update startup toggle is disabled in this build")` | Toujours ignoré | Fonctionnalité de build désactivée | Justifier : l'auto-mise à jour n'est pas supportée dans ce build | P3 |

## Actions

1. Ouvrir une issue par groupe, avec les preuves de ce registre.
2. Réactiver le groupe A par PR, sur la CI, en vérifiant chaque correctif au SHA concerné.
3. Trancher le groupe B avec le propriétaire (périmètre v110), puis implémenter ou retirer.
4. Corriger le groupe C par configuration de test, sans toucher aux assertions.
