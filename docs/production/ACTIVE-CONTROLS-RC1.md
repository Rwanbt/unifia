<!-- SPDX-License-Identifier: MIT -->
# Contrôles actifs RC-1 — inventaire `UI → action → API → autorité → effet → preuve`

**Document de travail pour #548** (gate « inventaire exhaustif des contrôles actifs, absents et SOON »,
LOT B §6.1 du contrat `RC1-AUTONOMOUS-GOAL.md`). Il complète `CONTROLS-GREYED-RC1.md`, qui couvre les
contrôles *grisés* ; celui-ci couvre les contrôles **actifs**, les routes **503**, les `disabled` sans
marqueur « bientôt », les entrées de menu masquées et le clavier/tactile.

Base : `origin/dev` à `24c2b93588`, le 2026-10-15. Chaque ligne est reproductible par les commandes du §1.

## 1. Méthode

Quatre passes, parce qu'aucune ne suffit seule : un contrôle peut passer par le SDK, par un `fetch` direct,
par un client dédié, ou par le **pont Workbench** — un client typé distinct, structurellement invisible à la
passe 1.

| Passe | Commande | Résultat (base) |
|---|---|---|
| 1. Appels SDK | `git grep -n -o -E 'client\.[a-zA-Z]+\.[a-zA-Z]+' -- packages/app/src` | 180 sites, 101 appels uniques, 53 fichiers |
| 2. Requêtes directes hors SDK | `git grep -n -E 'fetch\(.\{0,20\}\$\{sdk\.url\}' -- packages/app/src` | 13 sites |
| 3. Client hors SDK | `packages/app/src/utils/knowledge-client.ts` | 7 routes `/knowledge/*` |
| 4. Pont Workbench | `git grep -n -o -E '\.client\.[a-zA-Z]+\(' -- packages/app/src` | 65 sites, 40 méthodes, 12 fichiers (§2.5, §2.6, §2.7, §2.11) |

La passe 1 ne peut pas voir la passe 4 : un site du pont s'écrit `.client.<méthode>(` sur la connexion rendue
par `workbench.connection()` (`packages/app/src/context/workbench/provider.tsx`), jamais
`client.<namespace>.<méthode>` sur le client v2. C'est l'erreur que la première version de ce document a
commise (§8) : une zone qui ne contient aucun appel SDK n'est pas une zone sans autorité.

- Client de l'application : **`@unifia/sdk/v2`** (`packages/sdk-shared/src/index.ts` réexporte
  `@unifia/sdk/v2/client`). Le mapping méthode → route est lu dans le généré
  `packages/sdk/js/src/v2/gen/sdk.gen.ts` (219 entrées), jamais deviné.
- Autorité : `packages/unifia/src/server/route-classes.ts` — une **classe d'action** par route, avec
  **refus par défaut** pour toute route non listée. Le test
  `packages/unifia/test/server/route-registry.test.ts` garantit l'égalité « routes enregistrées ↔ routes
  classées », donc la table du §2 est exhaustive côté serveur.
- Le niveau minimal par classe est la table unique de `packages/unifia/src/server/route-authz.ts` : une
  route lit sa classe ici, et le niveau requis là, jamais localement.
- Le pont Workbench est servi par un **runtime distinct** (`packages/unifia/src/server/workbench.ts`), sur une
  origine loopback dédiée, avec son propre jeton porteur ; l'application ouvre la connexion par
  `GET /v1/handshake` (`packages/workbench-shell/src/client.ts`). Son autorité n'est donc **pas**
  `route-classes.ts` : ce sont `packages/workbench-server/src/auth.ts` et l'allowlist
  `SURFACE_GRANTED_CAPABILITIES`, épinglée aux registres de routes par
  `packages/workbench-shell/src/routes.test.ts`. Chaque route du registre déclare la **capacité** qu'elle
  exige (ex. `/v1/browser/...` → `browser.navigate|observe|interact|control`, `/v1/approvals` →
  `approval.read`) et la surface ne détient que `SURFACE_GRANTED_CAPABILITIES`
  (`packages/workbench-server/src/constants.ts:73-84` : `workspace.*`, `artifact.*`,
  `browser.navigate|observe|interact|control`) ; le reste passe par l'élévation (`STEP_UP_ELIGIBLE`) ou le
  broker d'approbations. La table du §2 reste exhaustive pour le serveur principal ; le runtime Workbench a sa
  propre porte (§2.11).

## 2. Chaîne par zone

« Effet durable » = ce qui survit au rechargement de la page. « Preuve » = la spec qui exerce la zone
(chemins du dépôt, exécutés par la CI sauf mention contraire).

### 2.1 Shell, navigation et projet

| Contrôle actif | Entrée UI | Appel → route | Classe | Effet durable | Preuve |
|---|---|---|---|---|---|
| Bandeau santé serveur | `app.tsx` (intervalle) | `global.health` → `GET /global/health` | read-metadata | aucun | `e2e/v110/anchors.spec.ts` |
| Listes de sessions | `pages/layout/prefetch.ts` | `session.list` → `GET /session` | read-content | aucun | `e2e/v110/a3-shell-mobile.spec.ts` |
| Sélecteur de projet | `pages/layout/project-actions.tsx` | `project.list`/`project.current` → `GET /project`, `GET /project/current` | read-metadata | aucun | `e2e/projects/*` |
| Édition d'un projet | `components/dialog-edit-project.tsx` | `project.update` → `PATCH /project/:projectID` | config | configuration du projet | `e2e/projects/*` |
| Init du dépôt git | `pages/layout/project-actions.tsx` | `project.initGit` → `POST /project/git/init` | admin | `.git` créé | — |
| Redémarrage d'instance | `pages/layout/workspace-ops.ts` | `instance.dispose` → `POST /instance/dispose` | admin | instance arrêtée/relancée | — |
| Dispose global | `context/global-sync.tsx` | `global.dispose` → `POST /global/dispose` | admin | serveur arrêté | — |
| État MCP (popover) | `components/status-popover-body.tsx` | `mcp.status` → `GET /mcp` | read-metadata | aucun | `e2e/status/*` |

### 2.2 Chat (session, permissions, questions)

| Contrôle actif | Entrée UI | Appel → route | Classe | Effet durable | Preuve |
|---|---|---|---|---|---|
| Envoyer un prompt | `components/prompt-input/submit.ts` | `session.prompt` → `POST /session/:sessionID/message` | write-content | message + réponse persistés | `e2e/v110/chat.spec.ts` |
| Envoi asynchrone (routage) | `components/prompt-input/submit.ts` | `session.promptAsync` → `POST /session/:sessionID/prompt_async` | write-content | idem | `e2e/v110/chat-agent-modes.spec.ts` |
| Commande slash | `components/prompt-input/submit.ts` | `session.command` → `POST /session/:sessionID/command` | write-content | message persisté | `e2e/v110/chat.spec.ts` |
| Interrompre | `pages/session/use-session-commands.tsx` | `session.abort` → `POST /session/:sessionID/abort` | write-content | génération arrêtée | `e2e/session/*` |
| Revenir / défaire | `pages/session/session-mutations.ts` | `session.revert`/`session.unrevert` → `POST /session/:sessionID/{revert,unrevert}` | write-content | historique du fichier | `e2e/session/*` |
| Compacter | `pages/session/use-session-commands.tsx` | `session.summarize` → `POST /session/:sessionID/summarize` | write-content | résumé persisté | — |
| Partager (lien) | `pages/session/session-title-menu.tsx` | `session.share` → `POST /session/:sessionID/share` | **admin** | session publiée | — |
| Ne plus partager | `pages/session/session-title-menu.tsx` | `session.unshare` → `DELETE /session/:sessionID/share` | **admin** | publication retirée | — |
| Dupliquer une session | `pages/session/session-mutations.ts` | `session.fork` → `POST /session/:sessionID/fork` | write-content | nouvelle session | — |
| Renommer / archiver | `context/sync.tsx` | `session.update` → `PATCH /session/:sessionID` | write-content | métadonnées | `e2e/session/*` |
| Répondre à une permission | `context/permission.tsx` | `permission.respond` → `POST /session/:sessionID/permissions/:permissionID` | write-content | décision enregistrée | `e2e/session/*` |
| Répondre à une question | `pages/session/composer/session-question-dock.tsx` | `question.reply`/`question.reject` → `POST /question/:requestID/{reply,reject}` | write-content | réponse enregistrée | `e2e/session/*` |
| Todo / diff / messages | `context/sync.tsx` | `session.todo`/`session.diff`/`session.get`/`session.messages` | read-content | aucun | `e2e/v110/chat.spec.ts` |

### 2.3 Code (inspector, éditeur, recherche, LSP, git)

| Contrôle actif | Entrée UI | Appel → route | Classe | Effet durable | Preuve |
|---|---|---|---|---|---|
| Ouvrir / lire un fichier | `context/editor.tsx` | `file.read`/`file.readRaw` → `GET /file/content`, `GET /file/raw` | read-content | aucun | `e2e/files/*` |
| Enregistrer un fichier | `context/editor.tsx` | `file.write` → `POST /file/write` | write-content | fichier sur disque | `e2e/files/*` |
| Créer / renommer / déplacer / supprimer | `context/file/operations.ts` | `file.mkdir`/`rename`/`move`/`delete` → `POST /file/{mkdir,rename,move}`, `DELETE /file` | write-content | arborescence | `e2e/files/*` |
| Recherche texte / fichiers / symboles | `pages/session/code-inspector/search.tsx` | `find.text`/`files`/`symbols` → `GET /find`, `GET /find/file`, `GET /find/symbol` | read-content / read-metadata | aucun | `e2e/v110/editor-search.spec.ts` |
| Diagnostics, hover, définitions, références, complétion | `context/lsp-diagnostics.tsx`, `pages/session/lsp-actions.tsx` | `lsp.*` → `GET /lsp/diagnostics`, `POST /lsp/{hover,definition,references,completion}`, `GET /lsp` | read-metadata | aucun | `e2e/v110/code.spec.ts` |
| Renommer via LSP, action de code | `pages/session/lsp-handlers.ts` | `lsp.rename`/`lsp.codeAction` → `POST /lsp/{rename,code-action}` | write-content | fichiers modifiés | `e2e/v110/code.spec.ts` |
| Stage / reset / commit / branche | `components/source-control.tsx` | `git.add`/`reset`/`commit`/`branch` → `POST /git/{add,reset,commit,branch}` | write-content | index et historique git | `e2e/v110/a4-code-chrome.spec.ts` |
| Push / pull | `components/source-control.tsx` | `git.push`/`git.pull` → `POST /git/{push,pull}` | **execute** | dépôt distant | — |
| Log / blame / branches / status | `components/source-control.tsx`, `pages/session/editor-panel.tsx` | `GET /git/{log,blame,branches,working-status}` | read-content / read-metadata | aucun | `e2e/v110/a4-code-chrome.spec.ts` |

### 2.4 Work et Team

| Contrôle actif | Entrée UI | Appel → route | Classe | Effet durable | Preuve |
|---|---|---|---|---|---|
| Démarrer un run | `pages/workbench/work-start-run.tsx` | `team.startRun` → `POST /team/runs` | write-content | run enregistré | `e2e/v110/work-start-run.spec.ts` |
| Pause / reprise / annulation | `pages/workbench/work-timeline-panel.tsx` | `team.pauseRun`/`resumeRun`/`cancelRun` → `POST /team/runs/:runID/{pause,resume,cancel}` | write-content | état du run | `e2e/v110/work-*.spec.ts` |
| Statut d'une tâche | `pages/workbench/work-timeline-panel.tsx` | `team.setTaskStatus` → `POST /team/runs/:runID/tasks/:taskID/status` | write-content | tâche mise à jour | `e2e/v110/work-disabled-controls.spec.ts` |
| Publier une mise à jour de projet | `pages/workbench/work-project-update.tsx` | `team.generateProjectUpdate` → `POST /team/runs/:runID/updates` | write-content | note de projet | — |
| Lire runs / events / gates / tâches | `context/team.tsx` | `team.list*`, `team.getRun`, `team.latestProjectUpdate` | read-content | aucun | `e2e/v110/work-*.spec.ts` |
| Configuration d'équipe | `context/local.tsx` | `team.getConfig` → `GET /team/config` ; `team.config` → `PUT /team/config` | read-metadata / **admin** | configuration | — |
| Santé et liste des modèles | `context/team.tsx` | `modelIntelligence.health`/`listModels` → `GET /model-intelligence/{health,models}` | read-metadata | aucun | — |

### 2.5 Design

La zone attache une autorité réelle par le **pont Workbench** (§1, passe 4). Les appels SDK sont bien absents,
mais ils ne sont qu'une des quatre passes ; la version initiale de ce document en a conclu à tort « aucun appel
serveur » (§8).

| Contrôle actif | Entrée UI | Appel pont → route | Autorité | Effet durable | Preuve (zone) |
|---|---|---|---|---|---|
| Valider une spécification | `pages/workbench/design-surface.tsx` | `validateSpec` → `M11_SERVER_ROUTE_REGISTRY.specValidate.route` | allowlist `SURFACE_GRANTED_CAPABILITIES` | aucun | `design-surface.test.ts` |
| Systèmes de design | `pages/workbench/design-surface.tsx` | `listDesignSystems` | idem | aucun | `design-studio.test.ts` |
| État Git/GitHub de la zone | `pages/workbench/design-surface.tsx` | `githubStatus` | idem | aucun | `design-toolbar.test.ts` |
| Fichiers du projet design | `design-files-tab.tsx`, `design-files-thumbnail.tsx` | `listFiles`/`readFiles`/`createFiles`/`renameFile`/`removeFiles` | idem : l'allowlist de la surface **autorise** ces écritures | fichiers sur disque | `design-files-preview.test.ts`, `design-files-thumbnail-queue.test.ts` |
| Artefacts (créer, lister, exporter, présenter) | `design-surface.tsx`, `design-artifact-tab.tsx`, `work-artifact-menu.tsx`, `artifact-preview.tsx` | `createArtifact`/`artifactHistory`/`listArtifacts`/`exportArtifact`/`presentArtifactLink`/`readArtifactRaw` | idem | artefact persistant (`artifactRoot = Global.Path.data`) | `design-artifact-export.test.ts`, `artifact-preview.test.ts` |

Preuve d'exécution : `e2e/design/*` (3 specs), `e2e/v110/canvas-*.spec.ts` (9 specs).

### 2.6 Automate

Même correction : les 35 fichiers `automate-*.ts(x)` n'appellent aucun SDK, mais la barre d'exécution atteint
une autorité réelle et **durable** par le pont. La version initiale de ce document en a conclu à tort « aucun
appel serveur » (§8).

| Contrôle actif | Entrée UI | Appel pont → route | Autorité | Effet durable | Preuve (zone) |
|---|---|---|---|---|---|
| Démarrer un run | `automate-surface.tsx` (barre d'exécution) | `startWorkflow` → `POST /v1/workflows/start` | aucune capacité `workflow.*` n'est accordée à la surface (`constants.ts:73-84`) : le run passe par l'élévation / le broker, puis par un **jeton d'autorité de propriété** | run + autorité en SQLite (`Global.Path.data/workflows.sqlite`) | `automate-studio-run-bar.test.ts`, `automate-surface.test.ts` |
| Lister / piloter | `automate-surface.tsx` | `listWorkflows` → `GET /v1/workflows` ; `updateWorkflow` | le serveur refuse toute mutation sans jeton : `AUTHORITY_TOKEN_REQUIRED`, `STALE_AUTHORITY`, `AUTHORITY_NOT_CLAIMED` (`packages/workflow-runtime/src/authority.ts`) | état du run | `automate-authority.test.ts` |
| Récupérer un run après rechargement | `automate-surface.tsx` | `reclaimWorkflow` | le serveur ne rend le jeton qu'au principal qui a démarré le run, 403 sinon (CR05) | autorité récupérée | `automate-authority.test.ts` |
| Approuver une opération du run | `automate-surface.tsx` | `listApprovals`/`resolveApproval`/`cancelApproval` → `/v1/approvals[/:id]` | la capacité `approval.read` n'est **pas** accordée à la surface : le broker d'approbations tranche | décision enregistrée | `automate-surface.test.ts` |
| Fichiers du studio | `automate-surface.tsx` | `listFiles`/`readFiles`/`createFiles` | allowlist de la surface | fichiers | `e2e/v110/automate-*.spec.ts` |

Sans le port de runtime, **toutes** les routes `/v1/workflows` répondent `501` et Automate ne peut ni lister ni
démarrer (`packages/unifia/src/server/workbench.ts:212`) : l'absence de runtime est un état explicite, pas un
contrôle factice.

Conséquence sur la portée : **FX02 (#555)** n'est donc pas un raccordement d'autorité manquant, c'est le lot de
fonctionnalité (mode déterministe non destructif, fixtures, passation vers Work) au-dessus d'une autorité déjà
en place.

### 2.7 Memory

| Contrôle actif | Entrée UI | Appel → route | Classe | Effet durable | Preuve |
|---|---|---|---|---|---|
| Lire / éditer une note du vault | `pages/session/memory-panel.tsx` | `file.read`/`readRaw`/`write` → `GET /file/content`, `POST /file/write` | read-content / write-content | note sur disque | `e2e/v110/memory-note-actions.spec.ts` |
| Liste du vault, liens, backlinks, recherche | `pages/session/memory-panel.tsx` | via `context/file` et `find.text` | read-content | aucun | `e2e/v110/memory-*.spec.ts` |
| Graphe de connaissances | `pages/session/memory-knowledge-graph.tsx` | aucun appel (rendu local) | — | aucun | `e2e/v110/memory-graph-*.spec.ts` |

**Amendement (§1, passe 4).** `packages/app/src/pages/session/memory-panel.tsx` appelle aussi le **pont
Workbench** pour les opérations de fichiers (`listFiles`, `readFiles`, `createFiles`, `renameFile`,
`removeFiles` — 5 sites). Les deux transports coexistent donc dans ce panneau ; le départ ligne à ligne entre
`context/file` et le pont reste à établir (§9).

L'autorité `/knowledge/*` (classe **admin**, 7 routes) n'a **aucun consommateur** dans l'application :
voir §6.1.

### 2.8 Terminal

| Contrôle actif | Entrée UI | Appel → route | Classe | Effet durable | Preuve |
|---|---|---|---|---|---|
| Ouvrir / fermer un terminal | `context/terminal.tsx` | `pty.create`/`pty.remove` → `POST /pty`, `DELETE /pty/:ptyID` | **execute** | processus PTY | `e2e/terminal/*` (exclue de la CI, §7.2) |
| Ticket WebSocket du PTY | `components/terminal.tsx` | `collab.wsTicket` → `POST /collab/ws-ticket` | read-metadata | aucun | `e2e/terminal/*` |
| Attacher / lire un PTY | `components/terminal.tsx` | `pty.get` → `GET /pty/:ptyID` | **execute** | aucun | `e2e/terminal/*` |

### 2.9 Settings et Account

| Contrôle actif | Entrée UI | Appel → route | Classe | Effet durable | Preuve |
|---|---|---|---|---|---|
| Lire / écrire la config du projet | `components/settings-scope.tsx` | `config.get`/`config.update` → `GET /config`, `PATCH /config` | read-metadata / config | configuration | `e2e/settings/*` |
| Lire / écrire la config globale | `components/settings-system.tsx` (+ 4 fichiers) | `global.config` → `GET /global/config`, `PATCH /global/config` | read-metadata / config | configuration | `e2e/settings/*` |
| Clé d'un fournisseur | `components/dialog-connect-provider.tsx` | `auth.set`/`auth.remove` → `PUT|DELETE /auth/:providerID` | **credential** | identifiants stockés | `e2e/models/*` |
| Connexion OAuth d'un fournisseur | `components/dialog-connect-provider.tsx` | `provider.auth`/`provider.oauth` → `GET /provider/auth`, `POST /provider/:providerID/oauth/{authorize,callback}` | read-metadata / **credential** | jeton obtenu | `e2e/models/*` |
| Ajouter / retirer un serveur MCP | `components/settings-mcp.tsx` | `mcp.add`/`mcp.remove` → `POST /mcp`, `DELETE /mcp/:name` | config | configuration MCP | — |
| Connecter / authentifier un MCP | `components/dialog-select-mcp.tsx` | `mcp.connect`/`disconnect` → `POST /mcp/:name/{connect,disconnect}` ; `mcp.auth` → `POST /mcp/:name/auth` | **execute** / **credential** | processus lancé, jeton | — |
| Lister / installer / désinstaller une skill | `components/settings-skills.tsx` | `app.skills` → `GET /skill` (SDK) ; `POST /skill/install` (config) et `DELETE /skill/:name` (**admin**) en `fetch` brut | read-metadata / config / admin | fichier de skill | — |
| Observabilité (lectures) | `components/settings-observability*.tsx` | `observability.*` → `GET /observability/{health,settings,summary,summary/aggregate,compare,sessions,events,trace}`, `GET /observability/exporters/{config,preview/:eventId}` | **admin** | aucun | — |
| Consentement / rétention | `components/settings-observability-privacy.tsx` | `PUT /observability/privacy`, `POST /observability/privacy/revoke`, `DELETE /observability/data` | config | politique enregistrée | — |
| Test d'un exporteur | `components/settings-observability-exporters.tsx` | `POST /observability/exporters/test` | **execute** | événement émis vers l'extérieur | — |
| Compte console | `components/account/use-account.ts` | `experimental.console` → `GET /experimental/console` | read-metadata | aucun | — |
| Quota disque | `components/settings-disk-quota.tsx`, `components/settings-android.tsx` | `GET /disk` (`fetch` brut) | diagnostic | aucun | — |
| Identifiants git | `components/settings-git-auth.tsx` | `GET|PUT /git/credentials` (`fetch` brut) | **credential** | identifiants stockés | — |
| Connexion GitHub | `components/settings-github-auth.tsx` | `GET /github/status`, `GET /github/diagnostics`, `POST /github/device/{start,poll,cancel}`, `POST /github/{disconnect,test-connection}` (`fetch` brut) | read-metadata / diagnostic / **credential** | jeton GitHub | — |

### 2.10 Voice

| Contrôle actif | Entrée UI | Appel → route | Classe | Effet durable | Preuve |
|---|---|---|---|---|---|
| Démarrer / arrêter une session live | `src/voice/live-host.ts` | `POST /voice/live/session`, `GET /voice/live/status`, `POST|GET|DELETE /voice/live/bindings/:id[/session]` | write-content | session live | `src/voice/live-host.test.ts` (unitaire) |
| Prompt prononcé | `components/prompt-input/live-binding.ts` | `session.prompt`/`session.create`/`session.fork` | write-content | message persisté | — |
| Synthèse vocale | `src/voice/` | `POST /voice/tts`, `POST /voice/tts/cancel` (déclarées au registre) | write-content | aucun | — |

Aucune spec e2e ne couvre la voix : sa qualification est physique (**#117**, PC du propriétaire).

### 2.11 Pont Workbench : les canaux restants

Les zones §2.5 à §2.7 consomment l'essentiel du pont ; les canaux restants sont recensés ici, avec la même
grille que le §2.

| Canal | Entrée UI | Appel pont | Autorité | Effet durable | Preuve (zone) |
|---|---|---|---|---|---|
| Événements de la connexion | `context/workbench/provider.tsx` | `events` (flux `text/event-stream` du runtime) | jeton porteur de la connexion (`GET /v1/handshake`) | aucun | `provider.test.ts` |
| Session navigateur | `pages/workbench/browser-session-controller.ts` (12 méthodes : `openBrowserTab`, `navigateBrowserTab`, `screenshotBrowserTab`, `browserActivity`, `browserTabHistory`, `browserDownloads`, `inputBrowserTab`, `resizeBrowserViewport`, `setBrowserController`, `releaseBrowserDownload`, `uploadBrowserFile`, `getBrowserTabState`, `closeBrowserTab`) | routes `M26_BROWSER_ROUTE_REGISTRY` (`/v1/browser/sessions/:sessionId/tabs/:tabId/*`) | capacité déclarée par route (`browser.navigate|observe|interact|control|upload|download`) × allowlist de la surface + politique d'égress navigateur | session navigateur | `browser-session-controller.test.ts` |

Le navigateur est `DEFERRED_HIDDEN` (D2) : les canaux sont recensés, mais **aucune entrée UI** ne les atteint
(§5). L'audit ligne à ligne du runtime Workbench (contrôles d'accès de `auth.ts`, allowlist, handlers `/v1/*`)
n'est pas fait ici (§9).

## 3. Routes 503 recensées

| Route | Condition | Source | Contrôle qui la voit |
|---|---|---|---|
| `POST /github/device/start` (et le flux GitHub) | app OAuth non configurée → `github_not_configured` | `packages/unifia/src/server/routes/github.ts:130` | Connexion GitHub (§2.9) |
| `/knowledge/*` | vault indisponible → `memory vault unavailable` | `packages/unifia/src/server/routes/knowledge.ts:107` | aucun (§6.1) |
| `/model-intelligence/*` | registre non chargé → `model registry is not loaded yet` | `packages/unifia/src/server/routes/model-intelligence.ts:116` | Work/Team, listes de modèles |
| `/voice/live/*` | hôte absent ou LAN désactivé → `voice_host_unavailable`, `voice_host_lan_disabled` | `packages/unifia/src/server/routes/voice-live.ts:181,183` | Voice (§2.10) |
| `/voice/tts` | moteur indisponible → `voice_tts_unavailable` | `packages/unifia/src/server/routes/voice-tts.ts:84,107,112,124` | Voice (§2.10) |
| `POST /v1/chat/completions` (serveur LLM local embarqué) | modèle non prêt | `packages/unifia/src/local-llm-server/index.ts:918` | `components/dialog-local-llm.tsx` |

Côté application, `packages/app/src/context/team.tsx` classe un 503 en « registre en cours de chargement » :
c'est un état transitoire voulu, pas un contrôle mort.

## 4. `disabled` sans marqueur « bientôt »

Mesures (hors tests) sur la base :

| Mesure | Commande | Valeur |
|---|---|---|
| `disabled` | `git grep -l -E 'disabled' -- packages/app/src ':!*.test.*'` | 132 fichiers |
| `disabled` (lignes) | `git grep -n -E 'disabled[= ]' ...` | 258 |
| `aria-disabled` | `git grep -n -E 'aria-disabled' ...` | 26 |
| `data-soon` | `git grep -n -E 'data-soon' ...` | 9 |
| helper `soon(` | `git grep -n -E 'soon\(' ...` | 28 |

Règle de tri : un `disabled` est **transitoire** (chargement, validation, absence de sélection — la grande
majorité des 258), **différé** (il porte alors `aria-disabled` + infobulle, voir `CONTROLS-GREYED-RC1.md`),
ou **structurel**. Le classement ligne à ligne des 258 n'est pas fait ici : la mesure et la règle le rendent
reproductible, la revue ligne à ligne reste à faire (voir §8).

## 5. Menus masqués, clavier, tactile

- Entrées masquées : palette de commandes et commandes de session (`pages/session/use-session-commands.tsx`),
  menus contextuels de l'arbre de fichiers et du canevas, popovers de statut
  (`components/status-popover-body.tsx`). Aucune de ces entrées n'est un canal d'action distinct : elles
  appellent les mêmes routes que le §2.
- Densité clavier : 532 `onClick=` contre 36 `onKeyDown=` (hors tests) — le ratio ne prouve pas un défaut
  (les boutons natifs sont atteignables au clavier), mais il situe le travail de certification
  **#553 (UI13/UI14)**, qui reste le propriétaire du verdict clavier/tactile.
- Tactile et responsive : `e2e/v110/*-responsive.spec.ts` (7 specs) et `e2e/v110/a3-shell-mobile.spec.ts`.
- **Browser (`DEFERRED_HIDDEN`, D2) : accès UI vérifié absent.** La destination `browser` n'a aucun point
  d'entrée : le seul appelant de `mode.select()` de toute l'application est `pages/home.tsx` ; les six pastilles
  d'accueil (`MODE_PILLS`) ne ciblent jamais `browser` (`PILL_TARGET.browser = "design"`) ; `BrowserSurface`
  n'est monté que pour `mode.destination() === "browser"` (`pages/session.tsx:1164`), destination qu'une URL
  saisie seule atteint. Observation à trancher avec la parité Design (#552) : la pastille **libellée**
  « Browser » sélectionne le mode Design, et « Memory » le mode Code — leur libellé ne correspond pas à la
  destination atteinte.

## 6. Écarts — autorité sans contrôle actif

Ces routes existent, sont classées et répondent, mais **aucun contrôle de l'application ne les appelle**.
Ce n'est pas un placebo (rien n'est cliquable) : c'est de la dette de matrice de capacités à recenser pour
`CAPABILITY-MATRIX.md`.

- `GET /task`, `GET /task/:id[/messages|/team]`, `POST /task/:id/{cancel,followup,promote,resume}`
  (read-content / write-content)
- `GET /user/data/export` (read-content), `DELETE /user/data` (write-content)
- `GET /audit` (admin)
- `GET|POST /experimental/worktree`, `POST /experimental/worktree/reset`, `DELETE /experimental/worktree`,
  `GET|POST /experimental/workspace`, `DELETE /experimental/workspace/:id` (execute / admin)
- `/tui/*` (execute / write-content) — canal de pilotage du TUI, pas un contrôle d'interface
- `GET /knowledge/{status,tree,search,doctor,audit}`, `GET /knowledge/notes/:id[/backlinks]` (admin) — voir §6.1
- `GET /observability/export` (admin), `POST /model-intelligence/sync` (admin), `POST /provider/refresh` (admin)
- `POST /lsp/execute-command` (execute), `GET /agent-skills`, `POST /agent-skills/:toolId/execute`,
  `GET /command`, `GET /agent`, `GET /file/status`, `GET /vcs`, `GET /vcs/diff`, `GET /formatter`,
  `GET /experimental/{tool,tool/ids,resource,session}`, `GET /event`, `GET /ws/events`,
  `GET /permission`, `GET /question`, `GET|PUT|DELETE /pty/:ptyID/{tail,connect}`, `GET /session/:sessionID/children`,
  `POST /session/:sessionID/init`, `POST /session/:sessionID/shell`, `GET|PATCH|DELETE /session/:sessionID/message/:messageID[/part/:partID]`,
  `GET /collab/users`, `POST /collab/{register,login,refresh,logout}`

### 6.1 Memory : autorité sans contrôle actif, et trois routes appelées qui n'existent pas

`packages/app/src/utils/knowledge-client.ts` expose 7 opérations (lignes 123–136). Aucun consommateur ne
les appelle : `git grep -E 'knowledge\.(status|tree|note|search|backlinks|links|propose)\(' -- packages/app/src`
ne renvoie rien ; le client est seulement instancié (`context/global-sdk.tsx:268`) et testé
(`utils/knowledge-client.test.ts`). Le panneau Mémoire lit les notes par les routes `file`, pas par
`/knowledge/*`.

Trois des sept chemins n'existent pas côté serveur — `packages/unifia/src/server/routes/knowledge.ts`
n'enregistre que `/status`, `/search`, `/notes/:id`, `/notes/:id/backlinks`, `/tree`, `/doctor`, `/audit`
(montés sous `/knowledge` par `server/instance.ts:70`) :

| Chemin appelé par le client | Enregistré ? |
|---|---|
| `/knowledge/status`, `/knowledge/tree`, `/knowledge/search`, `/knowledge/notes/:id/backlinks` | oui |
| `/knowledge/note?locator=…` | **non** |
| `/knowledge/notes/:id/links` | **non** |
| `POST /knowledge/propose` | **non** |

Ces trois appels répondraient 404 (la route n'étant pas classée, le refus par défaut s'applique). Comme
aucun contrôle ne les déclenche aujourd'hui, il n'y a pas de défaut visible : c'est du code mort à trancher
(implémenter les routes, ou retirer les trois méthodes).

## 7. Écarts — contrôles qui contournent le SDK

Treize sites appellent le serveur avec `fetch(`${sdk.url}…`)` au lieu du client typé. Ils fonctionnent,
mais ils échappent à la passe 1 du §1 et doivent être recensés à part :

| Fichier | Routes |
|---|---|
| `components/settings-github-auth.tsx` (7 sites) | `/github/{status,diagnostics,device/start,device/poll,device/cancel,disconnect,test-connection}` |
| `components/settings-git-auth.tsx` (3 sites) | `GET|PUT /git/credentials` |
| `components/settings-skills.tsx` (2 sites) | `POST /skill/install`, `DELETE /skill/:name` |
| `components/settings-disk-quota.tsx`, `components/settings-android.tsx` | `GET /disk` |

S'y ajoutent, hors `sdk.url` : `src/voice/live-host.ts` (`/voice/live/*`), `src/voice/nemo-transport.ts`,
`context/workbench/web-bridge.ts` (`POST /workbench-web/token`), `components/dialog-local-llm.tsx`
(serveur LLM local).

Le **pont Workbench** ne fait pas partie de cette liste : ce n'est pas un contournement, c'est un quatrième
transport typé, avec son propre registre de routes et sa propre porte d'authentification (§1 passe 4, §2.11).
Il est recensé à part uniquement parce que la passe 1 ne le voit pas — c'est précisément ce qui a produit
l'erreur corrigée au §8.

### 7.2 Preuve non exécutée par la CI

Le recensement statique des exclusions non conditionnelles se fait par
`git grep -n -E 'test\.fixme|test\.describe\.fixme|test\.skip\(true' -- packages/app/e2e` : il ne reste que
deux sites, tous deux listés ci-dessous.

| Spec | Exclusion | Motif | Train suivant |
|---|---|---|---|
| `e2e/terminal/*` | non exécutée en CI | le canevas ne reçoit pas les données PTY en 90 s sur runner partagé (`playwright.config.ts`) | #480 (groupe A) |
| `e2e/modes/mode-reload-stability` | conditionnelle | exécutée seulement par le workflow planifié (`E2E_RELOAD_STABILITY=1`) | — |
| `e2e/session/session-review.spec.ts:374` | `test.fixme` | défaut produit : les rangées d'accordéon périmées s'ajoutent au lieu d'être remplacées (échec déterministe, 24 titres au lieu de 14) | #734 |
| `e2e/settings/settings.spec.ts:668` | `test.skip(true, …)` | option d'auto-update désactivée dans ce build — cause écrite dans le code | — |
| Voice | pas de spec | qualification physique | #117 |

## 8. Constats ouverts par cet inventaire

Deux constats ont été transformés en issue pour porter leur train suivant :

| Issue | Constat | Source |
|---|---|---|
| #733 | `knowledge-client.ts` appelle trois routes que le serveur n'enregistre pas, et aucun contrôle ne consomme le client | §6.1 |
| #734 | Dernier `test.fixme` de l'arbre e2e : les rangées d'accordéon périmées s'ajoutent au lieu d'être remplacées | §7.2 |

### 8.1 Correction de la première version

La première version de ce document affirmait, aux §2.5 et §2.6, que les zones Design et Automate n'avaient
« aucun appel serveur ». C'était **faux** : les deux atteignent une autorité réelle par le **pont Workbench**,
que la passe « appels SDK » ne peut pas voir. La méthode porte désormais quatre passes (§1), les chaînes sont
corrigées (§2.5, §2.6, §2.7, §2.11) et le constat de portée en découle : **FX02–FX10 (#555–#563)** sont du
travail de fonctionnalité au-dessus d'autorités existantes, pas un raccordement d'autorité manquant.

## 9. Ce que ce document ne couvre pas

- Le classement **ligne à ligne** des 258 `disabled` (§4) : mesure et règle posées, revue à faire.
- La certification **clavier/tactile** (#553) et **visuelle/a11y** (#549) : elles gardent leurs propres
  gates et doivent consommer cet inventaire, pas le remplacer.
- La synchronisation de `CAPABILITY-MATRIX.md`, `GAP-REGISTER.md`, `M3-ACCEPTANCE-MATRIX.md` et
  `E2E-SKIP-REGISTER.md`, deuxième item du gate #548.
- L'audit ligne à ligne du **runtime Workbench** : la passe 4 recense les appels du pont, elle ne juge pas
  chaque contrôle d'accès de `packages/workbench-server/src/auth.ts`, de l'allowlist
  `SURFACE_GRANTED_CAPABILITIES`, ni des handlers `/v1/*`.
- Le départ ligne à ligne, dans `pages/session/memory-panel.tsx`, entre `context/file` et le pont (§2.7).
- La preuve d'exécution : ce document décrit les chaînes à un SHA ; il ne remplace pas le run de recette
  sur le SHA candidat (item 3 du gate #548, et FX11 #564).
