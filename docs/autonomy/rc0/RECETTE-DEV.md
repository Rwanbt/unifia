<!-- SPDX-License-Identifier: MIT -->
# Recette manuelle utilisateur — Unifia `dev`

**Version de la recette :** v1, 2026-10-09.
**Base testée :** `origin/dev` `ad86c65a01`, à compléter avec le SHA exact du build testé.
**Statut :** rédigée par un agent à partir du code, des libellés i18n et des tests existants. **Aucun scénario n'a été exécuté à l'écran par un agent.** Tous les statuts manuels sont « Non testé ». Seul le propriétaire les renseigne.

## 1. Règles de recette

| Statut | Signification |
|---|---|
| Non testé | Valeur de départ de chaque scénario |
| OK | Toutes les étapes donnent le résultat attendu, sur le SHA noté |
| KO | Au moins une étape ne donne pas le résultat attendu |
| Partiel | Une partie seulement est vérifiée ; préciser laquelle |
| Bloqué | Prérequis impossible à réunir ; préciser lequel |

Un KO se consigne avec : SHA testé, plateforme, étapes exactes, capture d'écran, et les logs du serveur pour la même période.

**Libellés :** les textes entre guillemets sont ceux de l'interface en anglais (`packages/app/src/i18n/en.ts`). La langue de test doit être l'anglais, sinon les libellés changent. « À confirmer » signale une étape que l'agent n'a pas vérifiée à l'écran : vérifier le libellé avant de conclure.

**Automatisé :** indique les tests qui couvrent déjà le scénario. Un test vert ne prouve pas que la fonctionnalité est utilisable : c'est la raison de cette recette.

## 2. Plateformes

| Plateforme | Statut de build | Priorité | Notes |
|---|---|---|---|
| Windows 11 (bureau, Tauri) | Connue | Première | Build et déploiement : voir `CLAUDE.md`, section Deployment. Le sidecar `unifia-cli.exe` doit être copié avec l'application. |
| Linux (bureau) | À confirmer | Deuxième | Aucun chemin de build Linux de bureau n'a été identifié dans les documents lus. Si indisponible : statut « Bloqué ». |
| Android (Tauri mobile) | À confirmer | Troisième | Build de plus de 5 minutes. Prérequis : `ORT_LIB_LOCATION`, bibliothèques natives (`check-android-runtime.mjs`). |
| Navigateur (`bun dev`, port 4444) | Connue | Référence seulement | Ce n'est pas la plateforme livrée. À utiliser pour reproduire un défaut, pas pour valider une recette. |

## 3. Prérequis communs

- **P-01 Installation propre.** Un répertoire de données vide. Pas de projet, pas de session, pas de réglage.
- **P-02 Un fournisseur de modèle.** Une clé API valide, ou un modèle local disponible. Sans cela, les scénarios qui appellent un modèle sont « Bloqué ».
- **P-03 Projet git de test.** Un dépôt avec une branche `master`, quelques fichiers dont `package.json`, et au moins un commit.
- **P-04 Projet non git.** Un dossier sans `.git`.
- **P-05 Deux projets.** P-03 et P-04, ou deux dépôts git distincts, pour les scénarios d'isolation.

## 4. Scénarios

Les scénarios sont classés par fonctionnalité. Les tâches RC-0 ouvertes sont citées, car elles décrivent ce qui manque encore. Un scénario dont la tâche RC-0 est ouverte peut échouer pour une raison déjà connue : le noter, sans le classer en défaut nouveau.

### 4.1 Workspaces et projets (transversal)

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-WS-01 | Activer les workspaces | P-03. Ouvrir la sidebar. Ouvrir le menu « More options » du projet. Cliquer « Enable workspaces ». | Le menu affiche « Disable workspaces ». Le bouton « New workspace » apparaît. | `projects/workspaces.spec.ts` (E2E, instable localement, voir section 6) | — | Non testé |
| REC-WS-02 | Cycle de vie d'un workspace | Sur un projet avec workspaces activés : « New workspace », renommer, réinitialiser, réordonner par glisser, supprimer. | Chaque action se reflète dans la sidebar. Après rechargement, l'état est conservé. | `projects/workspaces.spec.ts` (7 tests E2E) | — | Non testé |
| REC-WS-03 | Projet non git | P-04. Ouvrir le menu du projet. | « Enable workspaces » est désactivé. | `projects/workspaces.spec.ts` « non-git projects keep workspace mode disabled » | — | Non testé |
| REC-WS-04 | Éditer un projet et le retrouver | Menu du projet, « Edit ». Changer le nom et le script de démarrage, « Save ». Recharger la page. Rouvrir « Edit ». | Les valeurs enregistrées sont affichées après rechargement. | `projects/project-edit.spec.ts` (E2E, instable localement, voir section 6) | — | Non testé |
| REC-WS-05 | Changer de projet | P-05. Cliquer le second projet dans la sidebar, puis revenir au premier. | La session du projet actif s'affiche. L'URL correspond au projet. | `projects/projects-switch.spec.ts` | — | Non testé |

### 4.2 Team (Work et équipes d'agents)

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-TEAM-01 | Premier lancement sans configuration | P-01 sans fournisseur. Ouvrir le sélecteur de modèle (« Model », `team.selector.title`). | Le sélecteur s'ouvre et permet de choisir un modèle. Aucun blocage. | Non couvert par un E2E | **CR02** : impasse de cardinalité du sélecteur sur installation neuve | Non testé |
| REC-TEAM-02 | Portée du choix de modèle | Dans le sélecteur : « This session only », puis « Make default », puis « Back to default ». | La session garde son choix, le défaut reste global, « Back to default » restaure. | Unitaires `components/team` (2 fichiers) | — | Non testé |
| REC-TEAM-03 | Lancer un run | P-02. Mode **Work mode**. Ouvrir le formulaire de démarrage et lancer un run (libellés à confirmer). | Le run apparaît avec « Pending », puis « Running », puis « Completed » ou « Failed » (`team.runStatus.*`). | Serveur : 83 fichiers de tests `test/team`. E2E : 1 spec team. | — | Non testé |
| REC-TEAM-04 | Isolation entre projets | P-05. Lancer un run dans le projet A. Ouvrir le projet B, puis la liste des runs. | Le run de A n'apparaît pas dans B. | Serveur : `test/server/team-routes.test.ts` (parité inter-projets). Pas d'E2E. | — | Non testé |
| REC-TEAM-05 | Serveur injoignable | Arrêter le serveur pendant qu'une liste de runs est affichée. | « Showing the last known runs » et « Could not reach the server » (`team.runs.stale`, `team.runs.unreachable`). | Non couvert | — | Non testé |
| REC-TEAM-06 | Persistance des runs | Lancer un run jusqu'à « Completed ». Fermer l'application. La rouvrir. | Le run figure toujours dans la liste, avec le même statut. | Serveur : tests de migration et de lecture (`team-store-project-scope`) | — | Non testé |

### 4.3 Browser

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-BR-01 | État vide | Ouvrir une session. Cliquer « Browser » dans le rail des modes. | « Open a web address to begin. » | Unitaires `pages/workbench/browser-*` (8 fichiers). **Aucun E2E dédié.** | BR00 | Non testé |
| REC-BR-02 | Ouvrir une adresse | Saisir une adresse valide dans la barre, puis Entrée. | « Starting isolated Browser… », puis la page s'affiche avec un onglet titré. | Idem | BR01, BR02 | Non testé |
| REC-BR-03 | Onglets | « New tab ». Fermer un onglet (« Close {title} »). Observer « Loading » pendant un chargement. | Les onglets s'ouvrent, se ferment et l'onglet actif change correctement. | Idem | BR01 | Non testé |
| REC-BR-04 | Tailles d'affichage | Choisir « Desktop », « Tablet », « Mobile » dans les préréglages. | La taille de la fenêtre change. L'interface indique que l'émulation d'appareil n'est pas appliquée. | Idem | — | Non testé |
| REC-BR-05 | Reprise de contrôle | Cliquer « Take control », puis « Return to AI ». | Le contrôle passe à l'utilisateur, puis revient à l'IA. | Idem | BR03 | Non testé |
| REC-BR-06 | Adresses internes bloquées | Saisir `http://127.0.0.1` ou `http://localhost` dans la barre. | **Attendu cible :** l'accès est refusé. Aucune règle SSRF n'est encore garantie. | Non couvert | BR06 | Non testé |
| REC-BR-07 | Persistance après rechargement | Ouvrir deux onglets. Recharger la page. | Les onglets et leur adresse sont restaurés. | Non couvert | BR00, BR09 | Non testé |

### 4.4 Automate

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-AU-01 | Ouvrir le studio | Cliquer « Automate mode » dans le rail. | Le studio, la bibliothèque et la barre d'exécution s'affichent. | 18 fichiers unitaires `pages/workbench/automate-*`. E2E : 2 specs. | — | Non testé |
| REC-AU-02 | Validation d'une définition | Saisir du JSON invalide. Puis un graphe sans étape. | « Invalid JSON: … » puis « Definition has no steps — runtime will be a no-op. » | `automate-graph-validation.test.ts`, `automate-decode.test.ts` | — | Non testé |
| REC-AU-03 | Exécuter un run | Charger un graphe valide. Lancer depuis la barre d'exécution. | Le run passe par ses états et se termine. Les branches du graphe sont suivies. | `automate-run-state.test.ts` (unitaire) | **CR04** : le moteur exécute des étapes linéarisées, pas le graphe canonique | Non testé |
| REC-AU-04 | Runs après redémarrage | Lancer un run. Fermer l'application pendant son exécution. La rouvrir. | Le run figure dans la liste, et peut être repris ou annulé. | `automate-authority.test.ts` (unitaire) | **CR05** : autorité des runs non durable | Non testé |
| REC-AU-05 | Mode test | Activer le mode test (dry-run) sur un graphe. | Aucune action réelle n'est exécutée. Le résultat est transmis à Work. | Non couvert | **FX02** | Non testé |
| REC-AU-06 | Déclencheur planifié | Créer un déclencheur planifié à une minute. Attendre. | Le run démarre à l'heure prévue. | Non couvert | **FX03** | Non testé |

### 4.5 Voice Live

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-VO-01 | Démarrer une conversation Live | P-02. Cliquer « Start Live conversation » dans la barre de la session. | Le mode Live démarre, sans erreur, après l'autorisation du micro. | 40 fichiers unitaires `app/src/voice`. Serveur : `test/server/voice-live-routes.test.ts`. **Aucun E2E dédié.** | **VO02** : fournisseurs réels du chemin livré | Non testé |
| REC-VO-02 | Échange vocal | En mode Live, poser une question à voix haute. | La question est transcrite, la réponse est lue à voix haute. | Non couvert | VO02 | Non testé |
| REC-VO-03 | Micro refusé | Refuser l'autorisation du micro. | Un message explique le refus. L'application reste utilisable. | Non couvert | — | Non testé |
| REC-VO-04 | Reprise après arrêt | Arrêter le mode Live, puis le relancer. | Le second démarrage fonctionne sans relancer l'application. | Non couvert | VO04 | Non testé |
| REC-VO-05 | Langues | Parler dans les cinq langues visées. | Transcription et réponse dans la langue parlée. | Non couvert | **VO04** (qualification physique) | Non testé |
| REC-VO-06 | Android Live | Sur Android, démarrer le mode Live. | Le mode Live fonctionne sur le chemin livré. | Non couvert | **VO02**, **VO04** | Non testé |

### 4.6 Sovereign Knowledge (mémoire)

**Périmètre mesuré le 2026-10-10 (remplace l'hypothèse précédente).** Sovereign Knowledge est le module `packages/unifia/src/knowledge/` : 110 fichiers source dans 22 domaines (`memory`, `policy`, `facade`, `source`, `admin`, `wal`, `semantic`…), et 102 fichiers de tests sous `test/knowledge/`. Il couvre la mémoire canonique, la promotion, le consentement, les grants et l'audit, l'égress, l'import/export et les lifecycles (ADR `KNOW-0002` et `KNOW-0009`).

Chemins réellement atteints, vérifiés par les importeurs :
- CLI : `src/cli/cmd/knowledge.ts`, `src/cli/knowledge/*`.
- Contexte des sessions : `src/session/memory-context.ts`.
- Outil mémoire de l'agent : `src/tool/memory.ts`.

Ce qui n'est **pas** câblé à l'interface :
- Aucune route HTTP ne monte le module (`src/server/routes` ne le référence pas).
- Le panneau **Memory** de l'application ne lit pas le module. Il parcourt des fichiers Markdown sous `.unifia/memory/` via l'API fichiers (`listFiles`, `file.readRaw`). Consentement, provenance, classification et politiques n'y apparaissent pas.

Les scénarios de cette section doivent donc être réécrits autour de ces chemins (CLI, contexte de session, outil de l'agent) et de l'écart d'interface, avant toute recette utilisateur.

**Plan de raccordement du panneau Memory à la source de vérité (non implémenté).** Le dossier `.unifia/memory` est la source canonique (ADR `KNOW-0002`), et le module lit ce même dossier par défaut. Le défaut n'est donc pas une seconde mémoire : le panneau contourne la gouvernance. Il lit via l'API fichiers et écrit avec `sdk.client.file.write`, au lieu de passer par `search`, `get`, `propose` et `apply` de la façade. Les tranches, chacune testable seule :

1. **Lecture seule par route HTTP** (livrée, non utilisée par le panneau). `GET /knowledge/status`, `/knowledge/search`, `/knowledge/notes/:id` et `/knowledge/notes/:id/backlinks` interrogent la façade pour le projet de la requête. Une note retenue par la politique répond comme une note absente. Tests : `packages/unifia/test/server/knowledge-routes.test.ts`, 13 tests (autorisé et refusé, isolation entre projets, identifiants refusés avant lecture, aucune mutation des notes, authentification, routeur sans méthode d'écriture).
2. **Panneau en lecture par la route.** Afficher classification, provenance et liens, sans changer le format Markdown. Test E2E : une note créée par la CLI apparaît avec sa classification.
3. **Écritures par `propose` et `apply`.** Remplacer `file.write` par des intentions avec `reason` et `source`. Test : une écriture refusée par la politique ne modifie aucun fichier.
4. **Consentement et compartiments.** Exiger la classification à la création. Test d'isolation entre projets.
5. **Audit et `doctor`** exposés dans l'interface.

Décisions propriétaire préalables : G4, G8, G10 (ligne KN de la section 5). Aucune tranche n'est engagée dans cette passe.

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-KN-01 | Ouvrir la mémoire | Cliquer « Memory » dans le rail. | La liste des entrées s'affiche, ou un état vide. | 5 fichiers unitaires. **Aucun E2E dédié.** | — | Non testé |
| REC-KN-02 | Créer une entrée | Créer une entrée. Choisir sa classification : public, internal, secret. | L'entrée s'enregistre avec la classification choisie, et reste visible après rechargement. | Non couvert | — | Non testé |
| REC-KN-03 | Import sans consentement | Importer une source sans donner de consentement explicite. | **Attendu :** l'import est refusé (garantie G4, échec fermé). | `memory-governance` : 1 test | Décision G4 (owner) | Non testé |
| REC-KN-04 | Usage dans une session | Créer une entrée, puis poser une question qui la concerne dans une session. | La réponse s'appuie sur l'entrée. | Non couvert | — | Non testé |

### 4.7 Code

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-CO-01 | Ouvrir un fichier par la recherche | P-03. Appuyer sur Ctrl+Shift+P. Taper `package.json`. Attendre le résultat `package.json`, puis cliquer. | Un onglet `package.json` s'ouvre. Pas un autre fichier. | `projects/file-open.spec.ts` (E2E, corrigé dans PR #438) | Question ouverte : la palette affiche des résultats périmés pendant une recherche | Non testé |
| REC-CO-02 | Modifier et enregistrer | Ouvrir un fichier, le modifier, enregistrer. Rouvrir le fichier. | La modification est conservée. | `files/*` (5 specs ; couverture de l'édition à vérifier dans les specs) | — | Non testé |
| REC-CO-03 | Diagnostics | Ouvrir un fichier TypeScript comportant une erreur de type. | Un diagnostic apparaît dans l'éditeur. | Non couvert (LSP) | — | Non testé |
| REC-CO-04 | Contexte de l'inspecteur | Ouvrir l'inspecteur, sélectionner un élément, l'envoyer dans le message. | Le contexte est injecté dans le message. | Non couvert | **FX06** | Non testé |

### 4.8 Work

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-WK-01 | Panneaux du mode Work | Cliquer « Work mode ». | Les panneaux plan, runs, activité et timeline s'affichent. | 6 fichiers unitaires `work-*`. E2E : 7 specs `work`. | — | Non testé |
| REC-WK-02 | Démarrer un run | Ouvrir le formulaire de démarrage, saisir un objectif, lancer. | Le run apparaît dans les runs et dans la timeline. | `work-start-run-form.test.ts` | — | Non testé |
| REC-WK-03 | Approuver une action | Un run demande une approbation. Approuver. | L'action est exécutée. Le statut est mis à jour. | Non couvert | **FX01**, **CR03** (autorisation `workflow.run`, décision propriétaire) | Non testé |
| REC-WK-04 | Annuler une action | Sur une action terminée, cliquer Undo (libellé à confirmer). | L'action est annulée, et la trace reste visible. | Non couvert | **FX01** | Non testé |

### 4.9 Design

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-DE-01 | Ouvrir le mode Design | Cliquer « Design mode ». | Le canevas et la barre d'outils s'affichent. | 12 fichiers unitaires `design-*`. E2E : 5 specs design. | — | Non testé |
| REC-DE-02 | Créer et exporter un artefact | Créer un artefact, puis l'exporter. | Le fichier exporté s'ouvre et correspond à l'artefact. | `design-artifact-export.test.ts` | — | Non testé |
| REC-DE-03 | Approbation | Ouvrir une demande d'approbation de design et l'accepter. | La fenêtre se ferme, l'état est mis à jour. | `design-approval.test.ts` | — | Non testé |
| REC-DE-04 | Libellés traduits | Changer la langue. Parcourir le mode Design. | Aucun texte anglais en dur dans une autre langue. | i18n guards (partiels) | **CR09** | Non testé |

### 4.10 Transversal

| ID | Scénario | Étapes | Attendu | Automatisé | Tâche RC-0 ouverte | Manuel |
|---|---|---|---|---|---|---|
| REC-TR-01 | Installation et premier lancement | P-01. Installer le build. Lancer l'application. | L'application démarre, sans erreur, avec l'écran d'accueil. | Non couvert | QA12R (non lancé) | Non testé |
| REC-TR-02 | Redémarrage | Créer un projet, une session et un réglage. Fermer. Rouvrir. | Tout est conservé. | Partiel (tests de persistance côté serveur) | — | Non testé |
| REC-TR-03 | Erreur serveur | Arrêter le serveur pendant une session. Relancer-le. | La bannière de connexion s'affiche, puis disparaît. Aucun message n'est perdu. | Non couvert | — | Non testé |
| REC-TR-04 | Changement de langue | Passer en français, puis dans une langue asiatique, puis revenir. | Les libellés changent. Aucun libellé manquant. | Guards i18n (16 locales) | CR09 | Non testé |
| REC-TR-05 | Base existante | Ouvrir une base créée par une version précédente. | La base est migrée, une copie de sauvegarde est créée, les anciennes données restent accessibles. | Tests de migration serveur (`team-store-project-scope`) | — | Non testé |

## 5. Tâches RC-0 ouvertes qui bloquent une fonctionnalité

Ce tableau reprend les identifiants de `TASK-GRAPH-RC0-v2.3.json`. Tant qu'une tâche est ouverte, les scénarios liés peuvent échouer pour une raison déjà connue.

| Tâche | Sujet | Scénarios concernés |
|---|---|---|
| CR02 | Impasse du sélecteur de modèle Team sur installation neuve | REC-TEAM-01 |
| CR03 | Autorisation `workflow.run` (décision propriétaire) | REC-WK-03 |
| CR04 | Exécution du graphe canonique Automate | REC-AU-03 |
| CR05 | Autorité durable des runs Automate | REC-AU-04 |
| CR06 | Mutation du statut des tâches Team | REC-TEAM-03 |
| CR08 | Parité de l'éditeur Code | REC-CO-* |
| CR09 | Libellés Design en dur, i18n | REC-DE-04, REC-TR-04 |
| BR00 à BR10 | Runtime Browser unique, réseau, profils, E2E | REC-BR-* |
| FX01 à FX11 | Fermeture fonctionnelle Work, Automate, Code, Settings | REC-WK-*, REC-AU-*, REC-CO-04 |
| VO02 à VO05 | Voice Live : fournisseurs réels, CI, qualification physique | REC-VO-* |
| QA03 | Stabilisation de l'E2E (saturation, flakes) | REC-WS-*, REC-CO-01 |
| KN | Gouvernance mémoire G4, G8, G10 (décisions propriétaire) | REC-KN-* |

## 6. Problèmes de qualification connus

- **`workspaces.spec.ts` (REC-WS-01, REC-WS-02) et `project-edit.spec.ts` (REC-WS-04).** Cause démontrée : le menu d'un projet était démonté pendant le rechargement de la liste des projets (`<For>` sur des objets recréés par `enrich()`). Correction produit dans PR #441 (issue #440). Validation locale : 27 tests sur 27 en trois répétitions. Le scénario reste à confirmer à la recette, car la correction n'est pas encore fusionnée dans `dev`.
- **Test « non-git » (REC-WS-03).** Échec d'environnement : le répertoire personnel de la machine de test est un dépôt git, et le répertoire temporaire du test se trouve dedans. Le lanceur E2E pose désormais `GIT_CEILING_DIRECTORIES` (PR #441). Ce n'est pas un défaut produit.
- **`file-open.spec.ts` (REC-CO-01).** Correction de la course de test dans PR #438, `e2e (linux)` vert sur GitHub. La question produit reste ouverte : la palette affiche des résultats périmés pendant une recherche, et un clic peut ouvrir un fichier d'une requête précédente.

## 7. Preuves à fournir

Pour chaque scénario exécuté, conserver dans `docs/autonomy/rc0/evidence/recette/<date>/<plateforme>/` :
- le SHA de `dev` et la version du build ;
- la capture ou la vidéo du scénario ;
- les logs du serveur sur la même période ;
- le statut et, si KO, la description exacte.

Le dossier de preuves n'existe pas encore. Il est à créer lors de la première recette.

## 8. Classification par fonctionnalité

**État mesuré le 2026-10-10**, base `origin/dev` `ad86c65a01` (SHA figé pour cette recette). Les chiffres de tests sont des décomptes de fichiers, vérifiés dans le dépôt. Aucune case n'est « certifiée » : la recette manuelle du propriétaire n'a pas été exécutée.

Définitions :
- **Implémentée** : le code existe et est câblé à son consommateur (vérifié par lecture des points d'appel).
- **Testée** : des tests automatisés couvrent le comportement. Le SHA ou la branche qui a passé ces tests est indiqué.
- **Certifiée** : recette manuelle du propriétaire passée sur un build daté. Aucune à ce jour.
- **Bloquée** : une tâche RC-0 ouverte ou une décision propriétaire empêche de finir.

| Fonctionnalité | Implémentée | Testée automatiquement | Certifiée | Classement | Bloqué par |
|---|---|---|---|---|---|
| Workspaces et projets | oui (sidebar, menu projet, édition) | E2E `projects/` : 27/27 sur la branche de PR #441, trois répétitions. Pas encore sur `dev` | non | Testée (branche) | Fusion de #441. QA03 |
| Team | oui (store, routes HTTP, CLI). 83 fichiers de tests serveur | 898 tests verts sur la tête C, CI GitHub verte sur A, B, C. Non fusionnée | non | Testée (branche), bloquée | CR02 (sélecteur de modèle, installation neuve). CR06 (mutation du statut des tâches). Décision propriétaire sur la migration de la base. Isolation par projet en attente de fusion (#429 à #431) |
| Browser | oui (surface, service, 8 fichiers unitaires app, 12 fichiers `browser-runtime`) | Aucune spec E2E dédiée. Les mentions de « Browser » dans 13 specs ne prouvent pas un parcours | non | Implémentée, non testée de bout en bout | BR00, BR01 (service canonique), BR06 (SSRF), BR10 (E2E et sécurité) |
| Automate | oui (studio, validation, état des runs, 18 fichiers unitaires) | 2 specs dédiées : `v110/automate-branch-run`, `v110/automate-responsive`. Les autres specs ne font que le mentionner | non | Implémentée, bloquée | CR04 (étapes linéarisées, pas le graphe canonique). CR05 (autorité durable des runs). FX02 (mode test). FX03 (planificateur) |
| Voice Live | oui (client `/voice/live`, route serveur montée, 40 fichiers unitaires app) | 1 test de route serveur. Aucun E2E. `voice-core` n'a aucun test | non | Implémentée, non qualifiée | VO02 (fournisseurs réels du chemin livré). VO03 (CI bloquante). VO04 (qualification Android physique et Windows). VO05 |
| Sovereign Knowledge (`src/knowledge/`) | oui côté serveur, CLI et outil de l'agent (110 fichiers source). **Non câblé à l'interface** : le panneau Memory lit des fichiers `.unifia/memory/*.md` | 102 fichiers de tests sous `test/knowledge/` (unitaires, sans E2E) | non | Implémentée côté backend, défaut d'interface, non certifiée | Écart d'interface (panneau Memory). Décisions propriétaire G4, G8, G10. Périmètre des scénarios à réécrire (voir section 4.6) |
| Code (éditeur, recherche de fichier) | oui | E2E `files/file-open` : corrigé sur #438 (`e2e (linux)` vert). Correctif de la palette (clic sur une ligne périmée) en cours de validation | non | Testée partiellement | CR08 (parité éditeur). FX06 (contexte de l'inspecteur). Question produit sur les résultats périmés |
| Work | oui (panneaux plan, runs, activité, timeline. 6 fichiers unitaires `work-*`) | 5 specs mentionnent le mode Work, dont 3 dédiées (`v110/work-board-reload`, `v110/work-project-update`, `v110/work-start-run`) | non | Implémentée, bloquée | FX01 (APIs Run, Approve, Policy, Undo). CR03 (décision propriétaire sur `workflow.run`) |
| Design | oui (canevas, export, approbation. 12 fichiers unitaires `design-*`) | 4 specs dédiées : 3 dans `e2e/design/`, et `modes/design-mode.spec.ts` | non | Testée partiellement | CR09 (libellés en dur, i18n) |

### Ce qui n'est pas fait dans cette classification

- **34 scénarios manuels.** La matrice contient **51 scénarios** (section 4), pas 34. Le chiffre de 34 n'a pas de source dans ce dépôt. À confirmer avec le propriétaire : soit un sous-ensemble à désigner, soit une erreur de comptage. Aucun scénario n'est marqué comme exécuté.
- **Artefacts signés.** Aucun artefact signé n'a été produit ni vérifié. La signature officielle reste hors périmètre sans accord explicite (voir la consigne de phase).
- **Test de restauration.** Non écrit. La migration Team crée bien une copie `team.db.bak-*` avant d'agir (couvert par `TeamStoreMigration_OpenVersionOneDatabase_BacksUpFileBeforeChanging`), mais aucun test ne restaure cette copie et ne vérifie le résultat.
- **Build sur SHA figé.** SHA retenu : `ad86c65a01` (tête de `origin/dev` au 2026-10-10). Build non lancé. Mesure : 2,1 Go libres sur C: au moment du contrôle. `CLAUDE.md` impose `CARGO_BUILD_JOBS=1` pour le build desktop sur cette machine. Le build a besoin d'un accord sur l'espace disque avant de démarrer.
