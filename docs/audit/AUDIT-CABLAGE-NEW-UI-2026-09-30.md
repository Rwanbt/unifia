<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Audit du câblage réel de `new-ui` (2026-09-30)

Objet : vérifier ce qui est réellement branché de bout en bout, pas ce qui compile ou passe les tests. Les preuves sont
des exécutions ou des tests déterministes ; le niveau est indiqué (VÉRIFIÉ = exécuté, LU = lu dans le code).

## 1. Paquets atteints par le code livré

Contrôle : `node scripts/check-package-wiring.mjs` (ajouté à la CI `unifia-conformance`). Il calcule l'accessibilité par
imports de sources non-test depuis `@unifia/app`, `unifia`, `@unifia/desktop`, `@unifia/desktop-electron`,
`@unifia/mobile`. Résultat VÉRIFIÉ : 25 paquets atteints, 27 déclarés non livrés dans `scripts/package-wiring.json`.

Moteurs testés mais **sans aucun consommateur livré** (seulement des portes `release-hardening` ou des tests) :
`secret-broker`, `remote-bridge`, `computer-use-safety`, `sandbox-drivers`, `capability-runtime`,
`workbench-orchestrator`, `mcp-ui-actions`, `memory-governance`, `artifact-studio` (exports pptx/zip),
`artifact-store`, `media-runtime`, `scheduler`, `observability`, `browser-runtime`, `document-packs`,
`generative-ui-dom`, `desktop-runtime`. Aucune interface ne peut atteindre ces fonctions aujourd'hui.
Le contrôle échoue si un nouveau paquet reste orphelin ou si une entrée devient périmée.

## 2. Dépendances du serveur livré

`createWorkbenchApp` injecte : backend, artefacts, liens de présentation, `designSkills`, `github` et, depuis ce
correctif, `workflow`. Restent **non injectées** : `browser`, `desktop`, `memory`, `capabilities`, `ui`,
`uiAllowedActions`, `skillHub`. VÉRIFIÉ par appel réel du pont livré : leurs routes répondent 503
(`capability.unavailable`, `memory.unavailable`, `ui.unavailable`, `browser.unavailable`). Aucune surface de l'app ne
les appelle (`searchCapabilities`, `listDocuments`, `listDesignSkills` n'ont pas d'appelant ; `designSystems` non plus).

## 3. Automate : ce qui était cassé et ce qui est corrigé

| Constat | Preuve | Correction |
|---|---|---|
| Aucun runtime de workflow dans le serveur livré : toutes les routes `/v1/workflows*` répondaient 503/501 | LU + test pont | `NativeWorkflowRuntimePort` injecté (SQLite `workflows.sqlite` dans le dossier de données, ouverte à la première utilisation) |
| Lister les runs sur une base neuve échouait (« no such table: runs ») | VÉRIFIÉ (test rouge puis vert) | `listWorkflows` initialise les services d'abord |
| Resume/Cancel envoyés sans `workspaceId` ni jeton d'autorité : refusés à coup sûr | LU + test client | `updateWorkflow(id, action, {workspaceId, authority})`, en-tête `x-workflow-authority-token` |
| L'en-tête d'autorité aurait été bloqué par le préflight CORS d'un navigateur | LU | ajouté à `WORKBENCH_REQUEST_HEADERS` (source unique du CORS) |
| Un run démarré ne quittait jamais sa première étape : personne n'appelait `/run` | LU | `runWorkflow(authority)` appelé après le démarrage ; le jeton est gardé par la surface |
| Familles de la bibliothèque non exécutables avec la config vide de l'éditeur | VÉRIFIÉ, `library-family-runnability.test.ts` | 11 entrées grisées « bientôt » (voir ci-dessous) |

Matrice mesurée avec une config vide (ce que le studio fournit, il n'a pas d'éditeur de config) :

- refusées au démarrage (`node-config-invalid`) : `control.if`, `switch`, `parallel`, `merge`, `map`, `repeat`,
  `while`, `child` ;
- échec à l'exécution : `tool.http`, `tool.transform` ;
- attendent leur événement externe (utilisables) : `trigger.manual`, `human.approval`, `wait` ;
- `trigger.schedule` reste « running » sans jamais se déclencher (aucun planificateur branché).

Parcours complet VÉRIFIÉ avec le vrai `WorkbenchClient` contre le pont livré
(`packages/unifia/test/server/workbench-automate-run.test.ts`) : démarrer, approbation du courtier, exécuter, lister,
annuler avec le jeton.

## 4. Décision qui revient au propriétaire

**Lancer un run Automate est refusé en 403 dans l'app livrée.** Le bail de l'app ne porte que
`workspace.read/write/watch` et `artifact.preview` ; le serveur refuse `workflow.run` avant l'approbation
(`server-helpers.ts`, décision du 2026-08-17, figée par `capability-scope.test.ts`, « workflow.run is never granted in
this branch »). Le commentaire de `unifia/src/server/workbench.ts` prévoit pourtant que les runs passent par le
courtier, et l'interface gère déjà « approbation requise → autoriser → relancer ». Tout le reste du chemin
fonctionne (test de bout en bout avec `workflow.run` dans le bail).

**Décision du propriétaire (RC-0 D1 = A, 2026-09-29) : step-up.** `workflow.run` est ajouté à
`STEP_UP_ELIGIBLE_CAPABILITIES` (`workbench-server/src/constants.ts`) : un jeton de base ne lance pas de run mais
atteint la porte d'approbation (202 `approvalRequired`). `workflow.run` reste hors de `SURFACE_GRANTED_CAPABILITIES`.
`capability-scope.test.ts` fige désormais : 202 sans run créé, refus si la porte refuse, refus après révocation du jeton.
Limite : la révocation d'une *approbation* déjà donnée n'existe pas (seule la révocation du jeton) : sous-carte CR03b.

## 5. Limites

- Le graphe dessiné n'est pas exécuté tel quel : `toIr` reconstruit des arêtes linéaires. C'est sans conséquence tant
  que seules `trigger.manual`, `human.approval` et `wait` sont ajoutables.
- Une annulation depuis la liste des runs ne fonctionne que pour un run démarré dans la session courante (le jeton
  d'autorité n'est pas relisible depuis la liste) ; sinon l'erreur d'annulation s'affiche.
- Non exécutables ici : build Tauri complet, Android, console cloud.
