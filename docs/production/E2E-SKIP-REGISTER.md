<!-- SPDX-License-Identifier: MIT -->
# Registre des tests E2E exclus

Base : `dev` `0369a8618c` (après #473). Source : `playwright test --list` avec `CI=1` (liste des annotations `skip` et `fixme` sans exécution), complétée par l'inspection des sites de `test.skip(...)` conditionnés à l'exécution. Le run CI de #473 a compté 263 réussies, 51 ignorées, 0 échouée.

Groupes : **A** instables, à stabiliser puis réactiver ; **B** fonctionnalité absente, à implémenter si dans le périmètre ; **C** conditions de configuration, à corriger ou à justifier.

Les 39 tests annotés statiquement sont listés ci-dessous. Les exclusions conditionnées à l'exécution (18 sites) sont listées par site. Le décompte exact des 51 par run est à confirmer par le log CI de chaque run : c'est la preuve de référence.

## Groupe A — instables (conditionnés à `CI`)

| Fichier | Tests | Raison actuelle | Capacité testée | Fonctionnalité existe ? | Pertinence plateforme | Correctif nécessaire | Priorité |
|---|---|---|---|---|---|---|---|
| `session/session-composer-dock.spec.ts` | 1 (todo dock) ; les 12 autres réactivés par #662 | Délai de 120 s dépassé en CI sans étape en échec | Dock de todos du composer | Oui (dock présent) | Moyenne | Lire la trace Playwright du run de #662 pour trouver l'étape bloquée. L'ancienne raison (« aria-pressed race ») était fausse : le helper visait un bouton bascule remplacé par le Select de mode d'acceptation | P1 |
| `settings/settings-keybinds.spec.ts` | 8 (raccourcis sidebar, terminal, paramètres, nouvelle session, fichier, palette, réinitialisation, effacement) | « waitTerminalFocusIdle exceeds 90s » | Édition et persistance des raccourcis | Oui | Moyenne | Cause réelle à établir : le helper attend un terminal focus idle qui n'arrive pas en CI | P2 |
| `status/status-popover.spec.ts` | 7 (ouverture, onglets compute/lsp/mcp/plugins, fermeture) | « tab switch timing race » | Popover d'état et ses onglets | Oui | Moyenne | Attendre l'onglet actif par état applicatif, pas par délai | P2 |

**Disposition RC-1 au 14/10/2026 (décisions du propriétaire) :** `home.glance` et `code.diff` sur ordinateur sont `REQUIRED` ; la barre d'onglets de workspace et `code.diff` compact et mobile sont `NOT_IN_RC1`. Les PR #591, #592 et #663 sont fusionnées sur `dev` ; leurs tests `v110` ne sont plus en `fixme`. Ils ne comptent comme passés qu'avec une CI verte au SHA candidat. Les trois autres `fixme` du groupe B restent à diagnostiquer sous #480.

## Groupe B — fonctionnalité absente (`fixme`)

| Fichier | Test | Capacité | Fonctionnalité existe ? | Constat | Décision de périmètre | Priorité |
|---|---|---|---|---|---|---|
| `v110/home-glance.spec.ts` (×3) | cellules `home.glance`, valeurs numériques, rayon | Résumé d'accueil | Oui, depuis #592 (`e69c85fc0`) | Réactivé : plus de `fixme` sur `dev` | Décidé le 14/10 : garder (`REQUIRED`) ; preuve CI au SHA candidat | P2 |
| `v110/a4-code-chrome.spec.ts`, `v110/shell.spec.ts`, `v110/responsive.spec.ts` | barre d'onglets de workspace (`shell.workspace-tabs`) | Onglets de workspace | Monté depuis #591 (`0711bfd64`) | Réactivé : plus de `fixme` sur `dev` | Décidé le 14/10 : hors version 1 ; retrait de l'écran à planifier | P2 |
| `v110/code.spec.ts` | `code.diff` | Vue des modifications | Sur ordinateur, depuis #663 (`8ec95f3ed`) | Réactivé sur ordinateur | Décidé le 14/10 : ordinateur `REQUIRED`, compact et mobile `NOT_IN_RC1` | P2 |
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

## Correction du 15/10/2026 (preuves CI et locales du cycle RC-1)

Les constats des groupes A et C ci-dessus étaient en partie périmés. Ce tableau les remplace. Un état « CI verte » vaut pour le head indiqué, pas pour la fusion dans `dev`.

| Fichier | Constat antérieur | Constat au 15/10 | Suite |
|---|---|---|---|
| `status/status-popover.spec.ts` (lignes 19 et 50) | Skip sous `CI` (« tab switch race ») | Garde retirée. Les 7 tests passent sous `CI=1` en local. CI verte au head `d48d1169` (run `38727041520`) | Réactivé, PR #720 |
| `settings/settings-keybinds.spec.ts` (terminal, persistance) | Skip sous `CI` (« waitTerminalFocusIdle ») | Garde retirée. 10/10 de ce fichier passent sous `CI=1` en local, CI verte au head `d48d1169` | Réactivé, PR #720 |
| `settings/settings-keybinds.spec.ts` (nouvelle session) | Non skippé, échec déterministe local | Touche périmée : le test pressait `mod+shift+n`, pris par « New folder », au lieu de la touche réassignée `mod+shift+j`. L'URL est lue par `expect.poll` | Corrigé, PR #720 |
| `session/session-composer-dock.spec.ts` (todo dock) | Skip sous `CI`, « cause à établir » | Cause prouvée avec `DEBUG=pw:api` : le chevron est intercepté par le bouton `chat-copy-context` (superposition de mise en page). Le clic réessaie jusqu'au délai de 120 s | Reste skippé en CI ; correctif de mise en page à planifier, sans forcer le clic |
| `prompt/prompt-footer-focus.spec.ts` (2) | Skip « un seul agent / un seul modèle » | N'est pas skippé : les 2 tests passent en local avec le fournisseur `e2e` | Retiré du groupe C |
| `thinking-level.spec.ts` (1) | Skip « le modèle n'a pas de variantes » | Le sélecteur ciblé (`model-variant-cycle`) n'existe plus, et le modèle de test n'a pas de variantes | Corrigé, PR #719 : CI verte au head `403050b1` (run `38724994606`) |
| `session/session-model-persistence.spec.ts` (3) | Skip « pas de variantes / pas d'autre agent » | **Exclu de la CI** par `playwright.config.ts` (`testIgnore`, raison écrite : « async model picker race » et timeouts de 30 s en dur). Localement, avec variantes, 1 test sur 3 passe. Les tests 1 et 2 échouent sur le choix du second modèle : cause non résolue | NEEDS_OWNER : lot dédié pour réactiver |
| `prompt/prompt-slash-share.spec.ts`, `session/session.spec.ts` (partage) | Skip « partage désactivé » | `UNIFIA_DISABLE_SHARE` est défini à `true` par `script/e2e-local.ts`, donc aussi en CI. Le partage passe par une API distante | NEEDS_OWNER : harnais de partage hermétique, ou sortie du périmètre e2e |
| `session/session-review.spec.ts` (`fixme`, ligne 374) | Sans cause documentée | Défaut produit : `reconcile` de `session_diff` laisse des lignes d'accordéon périmées. La cause candidate est documentée dans le spec | Lot produit dédié, à prioriser |

État du 15/10 uniquement : les arbitrages propriétaires ultérieurs sur le groupe B sont consignés dans #581/#597. Ne pas rouvrir des décisions déjà prises.

## Mise à jour du 16/10/2026 — intégrations effectives, état transitoire

Ce registre conserve les observations du 15 octobre comme **historique** ; pour le nombre courant de `test.skip`/`test.fixme`, recalculer sur le **SHA cible** de `dev` et citer le run exact. Les « 51 skips » de l'issue #480 et les chiffres des tableaux initiaux ne sont pas un état courant. Un test ignoré n'est jamais une preuve de réussite.

| Lot | État effectif au 16/10 | Limite encore ouverte |
|---|---|---|
| #719 — niveau de réflexion | **Fusionné dans `dev`** (`758ab7833e`) ; sélecteur de variante E2E testé | Vérifier la CI cumulée à la tête finale de `dev` |
| #720 — keybinds / status | **Fusionné dans `dev`** (`d6eaa2e4bb`) ; gardes CI retirées sur les tests traités | Le test todo n'est pas certifié par cette seule PR |
| #725 — partage | **Fusionné dans `dev`** (`592f5588c9`) ; stub HTTP loopback pour vérifier le flux local UI | Ne prouve **pas** la synchronisation distante, les permissions ou l'API de partage en production |
| #724 — superposition todo | **Draft, non fusionné** ; correction responsive et test multi-viewport poussé, CI au nouveau SHA en cours | Garder le contrôle négatif sur mobile, ne pas réintroduire un `test.skip` CI |
| #736 — session Review | Reste la référence pour le dernier `test.fixme` Review connu (scroll accordéon) | Ne supprimer le fixme qu'après correctif produit et preuve E2E réelle |
| #552/#729 — snapshots Design | **Non qualifiés** : baselines Linux absentes et studio sans contenu dans les huit captures de #727 | Captures Linux approuvées séparément, vrai Canvas rendu, mutation détectable et deux runs stables |
| Groupe B | Décisions RC-1 ratifiées le 16/10 (#581, #597, #747) | Appliquer ces choix sans redemander d'arbitrage ; documenter précisément chaque exclusion restante |

Les assertions, les exclusions par plateforme et les valeurs mesurées doivent être établies à chaque tête Git/CI. La présente note est un journal de réconciliation, **pas** un gate RC-1 vert.