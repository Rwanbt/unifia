<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Plan d'exécution — correction des éléments non connectés de `new-ui`

Source : `docs/audit/AUDIT-NON-CONNECTE-NEW-UI-2026-09-29.md` (dans `D:\App\unifia\_newui-studio`, branche `new-ui` @ `f269f049de`). Les identifiants S1…S10 et §A…§J renvoient à ce rapport.

## Context

L'audit a montré que `new-ui` affiche des données inventées (Inspecteur et panneau gauche de Work/Design/Automate/Browser/Memory), qu'Automate ne peut lancer qu'un run par chargement et perd le graphe dessiné, que le canevas Design n'existe que dans le `localStorage`, et que 32 modules ne sont jamais importés. Le plan corrige tout cela **sans ajouter de nouvelles fonctions produit** : les contrôles « bientôt » restent grisés.

Décisions du propriétaire (2026-09-29) :
1. **Factices → brancher sur l'état réel** (Inspecteur et panneau gauche).
2. **Design → persistance dans le workspace** `.unifia/design/*.design.json` (repli `localStorage` en web).
3. **Périmètre → défauts + code mort**, pas de nouvelles fonctions (Work Run/Approve, Test Automate, → Work, Terminal Problèmes… restent « bientôt »).

## 0. Règles absolues (à relire avant chaque tâche)

1. Travailler dans `D:\App\unifia\_newui-studio` (branche `new-ui`). Jamais de `push --force`, `reset --hard`, `stash`, `rebase`. Un commit par tâche, message `<type>(<scope>): <desc>` en anglais.
2. **Pas de fonction factice, pas de donnée inventée.** Un contrôle sans moteur reste `aria-disabled` + infobulle « bientôt » (motif existant : `Soon` dans `work-cockpit.tsx`, `pages/session/code-inspector/parts.tsx`).
3. **Ne pas toucher** icônes, animations, `@keyframes`, `transition`. Ne pas corriger les écarts volontaires (décisions #98, ADR-039/053/058, pastilles du compositeur, orbe Live ON/OFF, barre d'état éditeur limitée).
4. **Éditions** par remplacement de texte exact (ancre littérale) ; jamais `sed`/regex sur le source. Relire le fichier avant d'éditer (les numéros de ligne de ce plan sont indicatifs, les **ancres** font foi).
5. **Nouveau fichier** : en-tête `/* SPDX-License-Identifier: MIT */` (`.md` : SPDX + Copyright 2026 Unifia contributors).
6. **i18n** : toute nouvelle clé va dans **tous** les `packages/app/src/i18n/*.ts` (`fr.ts` en français, les autres en anglais), sinon `src/i18n/parity.test.ts` échoue. Préférer réutiliser une clé existante.
7. **Règles d'ingénierie** : fonction ≤ 50 lignes, fichier ≤ 500 (existant > 800 : extraire), pas de `catch {}` vide, pas de global mutable (utiliser un contexte Solid), commentaires « pourquoi » seulement, dépendances UI → Core → Types.
8. **Anti-boucle** : 3 tentatives ratées sur une tâche → `git checkout -- <fichiers de la tâche>`, écrire `BLOCKED Tn : <diagnostic 3 lignes>` dans `docs/audit/EXECUTION-LOG-CORRECTIONS.md`, passer à la suivante indépendante.
9. **Portée** : ne modifier que les fichiers listés par la tâche + le journal.
10. **Pré-commit par tâche** (depuis `packages/app`) : `bun typecheck` puis `bun test <fichiers concernés>`. Pas de `tsc` à la racine. **`bun turbo typecheck` seulement avec `--concurrency=1`** (OOM sinon). Husky lint toute la branche : ne jamais `--no-verify`.
11. Playwright : `PLAYWRIGHT_WORKERS=1`.

### Niveaux d'exécutant
- **[S]** petit modèle : tâche mécanique, ancres et code fournis, aucune décision.
- **[L]** grand modèle : conception, plusieurs fichiers, arbitrages locaux. Un [S] ne doit pas prendre une tâche [L].

## 1. Préparation (une fois)

```bash
cd /d/App/unifia/_newui-studio && git status -sb   # attendu : propre, new-ui
cd packages/app && bun typecheck && bun test        # référence verte avant tout changement
```
Créer `docs/audit/EXECUTION-LOG-CORRECTIONS.md` (SPDX + `# Journal d'exécution des corrections`), le commiter seul (`docs(audit): start corrections log`).

Vérification navigateur (utilisée par les tâches marquées **[NAV]**), sans build Tauri :
```bash
sleep 100000 | bun run --conditions=browser --cwd packages/unifia src/index.ts serve --port 7777 &
cd packages/app && VITE_OPENCODE_SERVER_PORT=7777 bunx vite --port 3001 &
```
Route : `http://localhost:3001/RDpcQXBwXHVuaWZpYVxfbmV3dWktc3R1ZGlv/<mode>` (`session`, `design`, `automate`, `work`, `browser`, `memory`). Work/Automate/Memory exigent le pont Workbench : le simuler avec `window.__UNIFIA_PLATFORM__` (client mock prêt dans `packages/app/e2e/fixtures/workbench-mock.ts`, option `listFiles`). Arrêter les serveurs à la fin (`taskkill /PID <pid> /F /T`).

---

## Phase 1 — P0 : Automate (S3, S4)

### T1 [S] — Run bar : état qui revient à « idle » et Stop pendant `running` (S3)
Fichiers : `packages/app/src/pages/workbench/automate-surface.tsx` (~l.94, 324-395, 440-447, 532-541), `automate-studio-run-bar.tsx` (~l.83-84, 104), test neuf `automate-run-state.test.ts`.

Cause : `runState` renvoie `"running"` si `workflowState()` est non vide ; jamais remis à `undefined`. Statuts réels (`packages/contracts/src/workflow-run.ts:90`) : `running | waiting | completed | failed | cancelled | cancelled_with_active_effect | cancelled_with_unknown_external_state`.

Étapes :
1. Créer `automate-run-state.ts` (pure) : `export function runBarState(input:{error?:string; approvalId?:string; workflowState?:string}): RunBarState` avec la table : erreur → `failed` ; `approvalId` → `waiting-approval` ; `running`/`waiting` → `running` ; `cancelled*` → `cancelled` ; `completed` → `idle` ; `failed` → `failed` ; `deny`/`approval_required`/autres/undefined → `idle`. (Exporter aussi `isRunTerminal`.)
2. Dans `automate-surface.tsx`, remplacer le corps du memo `runState` par `runBarState({ error: workflowError(), approvalId: approvalId(), workflowState: workflowState() })`.
3. Stop pendant `running` : dans `AutomateStudioRunBar`, `canApprove()` reste pour Allow/Deny ; ajouter `const canStop = () => props.state === "waiting-approval" || props.state === "running"` et l'utiliser pour `disabled` du bouton Stop. Ajouter la prop `onStop?: () => void` ; dans la surface, `onStop` = si `approvalId()` → `cancelWorkflowApproval()`, sinon `current.client.updateWorkflow(runId, "cancel")` avec `runId` mémorisé à `startDefinition` (`result.state.runId` — vérifier le nom du champ dans le type de retour de `startWorkflow`) puis `workflowRuns.refetch()`.
4. Après `cancelled`, `Run` doit être de nouveau possible : `canStart` accepte `idle` **ou** `cancelled` **ou** `failed` (retirer l'erreur via `onDismissError` d'abord ou accepter directement). Écrire le test pour les 3 cas.
5. Remplacer les deux `.catch(() => undefined)` d'annulation (~l.615, ~l.657) par `.catch((error) => fail(error, "workbench.automate.cancelFailed"))` (clé existante).

Test `automate-run-state.test.ts` : une assertion par ligne de la table + « après completed, Run redevient possible ».
Vérif : `bun typecheck && bun test src/pages/workbench/automate`. Commit : `fix(automate): let the run bar start again and stop a running workflow`.

### T2 [L] — Graphe persistant : brouillon, Publish, Run (S4)
Fichiers : `automate-surface.tsx`, `automate-workflow-model.ts`, `automate-migrate-legacy.ts` (`buildCanonicalFromState`, `serializeCanonical`), `automate-studio-header.tsx`, tests `automate-workflow-model.test.ts`.

Constat : `graph()` (positions, arêtes, nœuds ajoutés) n'atteint `draftSource` que via `saveCanonical` ; `dirty` ne le voit pas ; `openDefinition` remet `EMPTY_GRAPH` ; `startSelectedWorkflow` n'envoie que `{id, version, steps}`.

Étapes :
1. **Lire** `automate-migrate-legacy.ts` et `automate-decode.ts` pour savoir si un brouillon canonique v2 est relu par `parseWorkflowDefinition` et si `startWorkflow` accepte le v2. Consigner la réponse dans le journal. **Si le runtime n'accepte pas le v2** : n'écrire dans le brouillon que ce que le runtime comprend (nœuds → `steps` ; positions/arêtes → métadonnées `ui` ignorées au Run) et envoyer au Run `steps` + nœuds ajoutés convertis en `steps`.
2. Rendre l'écriture automatique : dans `editGraph`, après `setGraph(next)`, appeler `syncGraphToDraft()` (= le corps actuel de `saveCanonical` sans le message d'avertissement), débouncé par le timer existant de `updateDraftSource`. `saveCanonical` reste comme action manuelle mais n'affiche plus l'avertissement de migration si la conversion est sans perte.
3. `dirty` : inchangé (compare brouillon/publié) — devient vrai automatiquement après T2.2, donc Publish s'active.
4. `openDefinition` : au lieu de `setGraph(EMPTY_GRAPH)`, recharger le graphe depuis le brouillon/publié via un décodeur `graphFromDefinition(definition)` (nouveau, pur, dans `automate-workflow-model.ts`, inverse de `buildCanonicalFromState`). Test aller-retour : `graphFromDefinition(buildCanonicalFromState(x))` égal à `x` (positions, arêtes, nœuds).
5. `startSelectedWorkflow` : envoyer la définition **du brouillon** telle que parsée (pas seulement `id/version/steps`) selon le résultat de l'étape 1.
6. `validate()` : garder `augmentValidateReport` (déjà basé sur `graph()`).

Vérif : tests unitaires ci-dessus + **[NAV]** avec mock : ajouter un nœud → Publish actif ; changer de workflow puis revenir → nœud présent. Commit : `fix(automate): persist the drawn graph into the draft and run what was drawn`.

### T3 [S] — Messages Automate en dur et textes anglais (P2)
Fichiers : `automate-studio-run-bar.tsx` (`validateDefinition`, l.~170-215), i18n. Remplacer les messages (« Invalid JSON… », « Missing or empty "id" field. », « Unsupported version… », « Step #n… ») par des clés `workbench.automate.runBar.validate.*` avec paramètres, dans tous les `i18n/*.ts`. Adapter `automate-studio-run-bar.test.ts` (les tests comparent des chaînes : passer par `t` injecté ou clés). Commit : `fix(automate): translate the validation messages`.

---

## Phase 2 — P0 : Inspecteur et panneaux gauche sur l'état réel (S1, S2, S6)

### T4 [L] — Infrastructure « inspecteur de mode » (contexte)
Fichiers neufs : `packages/app/src/context/mode-inspector.tsx`, `mode-inspector.test.ts`. Modifiés : `pages/session/mode-inspector-content.tsx`, point de montage (voir étape 2).

Conception (pas de global mutable) :
```ts
export type InspectorRow = { label: string; value: string }
export type InspectorCard =
  | { kind?: "card"; title: string; description?: string; rows?: readonly InspectorRow[]; actions?: readonly { label: string; run: () => void }[]; version?: { title: string; author: string } }
  | { kind: "head"; title: string; description: string }
// Un producteur (surface) publie des cartes pour SON mode ; le consommateur lit.
export function ModeInspectorProvider(props): JSX.Element   // store Solid par WorkspaceDestination
export function useModeInspector(): {
  cards(mode: WorkspaceDestination): readonly InspectorCard[]
  publish(mode: WorkspaceDestination, cards: () => readonly InspectorCard[]): void  // enregistre un accesseur réactif ; onCleanup → retire
}
```
Étapes :
1. Créer le contexte (accesseurs réactifs, `onCleanup` retire l'entrée du producteur).
2. Le monter au **plus petit ancêtre commun** de `SessionSidePanel` (`pages/session/session-side-panel.tsx:484`) et des surfaces de mode (montées sous `SessionRoute`, `pages/session.tsx`). Vérifier avec `grep -n "SessionProviders\|SessionSidePanel\|WorkbenchModeSurface" packages/app/src/app.tsx packages/app/src/pages/session.tsx`.
3. `ModeInspectorSurface` lit `useModeInspector().cards(mode)` ; **si vide** : carte d'état vide honnête `inspector.empty` (« Rien à inspecter ici ») — nouvelle clé i18n. Les `actions` deviennent des `<button onClick={action.run}>` ; plus de bouton sans handler.
4. **Ne pas encore supprimer** `INSPECTOR_CARDS` (T10).
5. Test : un producteur publie, le consommateur lit ; après dispose, retour à vide.
Commit : `feat(inspector): let each mode publish what its inspector shows`.

### T5 [L] — Design publie sa sélection (S6)
Fichiers : `design-canvas-tab.tsx`, nouveau `design/runtime/inspector-cards.ts` (+ test).
1. `inspector-cards.ts` : `designInspectorCards(document, selection): InspectorCard[]` pure. 0 sélection → `{kind:"head", title:"Aucune sélection"…}` (clés existantes `design…` sinon réutiliser le texte i18n déjà utilisé) ; 1 nœud → carte `nom`, `type`, lignes `x,y,largeur,hauteur,rotation`, `visible`, `verrouillé` ; n>1 → `n éléments`.
2. Dans `DesignCanvasTab`, `useModeInspector().publish("design", () => designInspectorCards(document(), selection()))`.
3. Test unitaire sur la fonction pure (0/1/n nœuds).
Vérif **[NAV]** : dessiner un rectangle → l'Inspecteur affiche « Rectangle » avec ses cotes. Commit : `feat(design): the inspector shows the canvas selection`.

### T6 [L] — Automate publie le nœud sélectionné (message faux)
Fichiers : `automate-surface.tsx`, `automate-studio-inspector.tsx`, nouveau `automate-inspector-cards.ts` (+ test).
1. Carte pure depuis `selectedNode()` : famille, index/total, position, arêtes entrantes/sortantes, `requiresApproval`. Sans sélection : carte vide honnête (texte existant « Cliquez sur un node… » est désormais vrai).
2. Publier dans `"automate"`. **Retirer la colonne `data-automate-studio-inspector-column`** (l.~582-598) et l'import `AutomateStudioInspector` **uniquement si** l'Inspecteur de droite est ouvert par défaut en mode Automate ; sinon la garder mais ouvrir l'Inspecteur (`layout.inspector.setTab("inspector"); layout.inspector.open()`) à la sélection d'un nœud sur bureau. Mobile : garder la colonne (Inspecteur en tiroir). Décider et consigner.
Commit : `feat(automate): the inspector shows the selected node`.

### T7 [L] — Memory publie la note ouverte
Fichiers : `pages/session/memory-panel.tsx`, `memory-panel-model.ts` (fonctions pures existantes : `parseMemoryNote`, `linkedMemoryNotes`, `memoryBacklinks`), nouveau `memory-inspector-cards.ts` (+ test).
Carte : titre + chemin du dossier ; `Propriétés` : tags (frontmatter/`#tag`), nombre de liens, nombre de backlinks, taille ; `Contexte IA` : « attachée à la session » selon l'état réel `toggleAttached` (déjà dans le panneau) ; actions réelles : « Retirer du contexte » = `toggleAttached`. **Supprimer** confiance 98 %, Verified, Provenance (aucune donnée). Sans note ouverte : vide honnête. Commit : `feat(memory): the inspector describes the open note`.

### T8 [S] — Work publie la tâche active
Fichiers : `work-surface.tsx`, nouveau `work-inspector-cards.ts` (+ test). `pickActiveRun`/`nextActionableTask` existent (`work-team.ts`). Carte : identifiant du run actif, statut, `taskId` prochaine tâche, `deps`, statut, progression `taskProgress` réelle ; sans run → vide honnête. **Retirer** « Agent : Designer ». Commit : `feat(work): the inspector reflects the active run`.

### T9 [S] — Browser, Paramètres, Compte : inspecteur honnête
- Browser : `DesignBrowserTab` publie `Contrôle` avec **uniquement** l'état réel (`Fenêtre native : ouverte/fermée`, URL courante, mode : natif/repli iframe). **Supprimer** la carte « Permissions » (aucun moteur).
- Paramètres : `settings-surface.tsx` publie la page active (clé/nom réels) — ou vide honnête.
- Compte : `user-surface.tsx` publie l'espace actif réel (nom, type) depuis le contexte compte ; **retirer** « Sessions : 4 ».
Commit par surface ou un seul : `feat(inspector): browser, settings and account inspectors show real state`.

### T10 [S] — Supprimer les cartes figées
`mode-inspector-content.tsx` : supprimer `NOTE_CARDS`, `INSPECTOR_CARDS`, `snapshotTime` ; adapter `mode-inspector-content.test.ts` (les tests lisent le source : réécrire pour vérifier l'absence de littéraux et l'usage du contexte). `bun test src/pages/session`. Commit : `refactor(inspector): remove the hard-coded inspector fixtures`.

### T11 [L] — Contexte de navigation par mode (source unique pour le panneau gauche)
Fichiers neufs : `context/mode-navigation.tsx` (+ test). Même patron que T4 : `publish(mode, sections)` avec `NavSection = { id; titleKey; rows: { id; glyph; label; active?: boolean; badge?: string; onSelect?: () => void }[] }`.
Modifier `sidebar-panel-mode-sections.tsx` : `StaticSection` devient `PublishedSection` lisant le contexte ; `NavRow` reçoit `onSelect`. Pas de rangée cliquable sans `onSelect` : rendre alors un `<div>` (pas un `<button>`). Supprimer les tableaux `rows=[…]` de `DesignSections/AutomateSections/MemorySections/BrowserSections`. Section vide → texte `v68-empty` existant. Commit : `feat(sidebar): mode sections come from the surfaces, not fixtures`.

### T12 [S] — Panneau gauche Automate
`automate-surface.tsx` publie : section « Workflows » = `mainFiles()` (nom fichier, `active` = `selectedDefinition()`, `onSelect = openDefinition`) ; section « Runs » = `workflowRuns.data` (`Historique` = total, `Échecs` = `status==="failed"`). Nécessite que la surface soit montée pour peupler la liste : acceptable (sinon lever la requête dans un provider — noter en journal). Commit : `feat(automate): the side panel lists the real workflows and runs`.

### T13 [S] — Panneau gauche Memory
`memory-panel.tsx` publie : « Notes » = notes du vault (clic → `setSelectedPath`), rangées Graphe/Recherche/Rétroliens **seulement si** branchées : Graphe → `setSurface("graph")`, Rétroliens → `setDrawer("links")`/`setContextView`, Recherche : **retirer** la rangée (pas de moteur). Commit : `feat(memory): the side panel navigates the real vault`.

### T14 [S] — Panneau gauche Design et Browser
- Design : `DesignCanvasTab` publie « Pages » = `[document().name]` actif (les autres pages n'existent pas) et « Design System » = catalogues du manifeste (`catalogs` prop, lecture seule, sans `onSelect`). Retirer Landing/Settings/Components.
- Browser : ne publier que des liens réels : historique de la session (adresses ouvertes, clic → réouverture) ; retirer Aperçu local/Dépôt/Documentation/Favoris/Téléchargements tant qu'aucune source n'existe.
Commit : `feat(design,browser): side panels list real data only`.

---

## Phase 3 — P1

### T15 [L] — Persistance Design dans le workspace (S5)
Fichiers : nouveau `design/persistence/workspace-repository.ts` (+ test) ; `design-canvas-tab.tsx` (~l.62 création du repository) ; `design/model/repository.ts` (interface `DesignDocumentRepository`, inchangée).
1. Lire `pages/workbench/automate-surface.tsx` (`draftStore`, `createFiles`) et `context/workbench/file-content.ts` pour le client : `connection().client.listFiles(workspaceId, prefix)`, `createFiles(workspaceId, [{path, content}])`, lecture (`file-content.ts`), suppression/renommage (`renameFile` cité dans le mock e2e). Écrire dans `.unifia/design/<id>.design.json`.
2. `createWorkspaceDesignDocumentRepository(connection)` implémente `load/save/remove` en réutilisant `loadDesignDocument` (migrations) et la gestion « schéma plus récent : ne jamais écraser » de `local-storage-repository.ts`.
3. Repository composite : si pont connecté → workspace (avec migration one-shot du `localStorage` existant : lire `unifia-design-document:v1:<id>`, l'écrire dans le workspace, **ne pas** effacer le localStorage) ; sinon → `localStorage`. Sélection dans `DesignCanvasTab` via `useWorkspaceWorkbench().connection()`.
4. Sauvegarde : conserver le débounce 400 ms ; erreur d'écriture → afficher l'état `error` dans la change-bar (nouveau `DesignSaveState = "saved" | "saving" | "error"`, clé i18n) au lieu de mentir « Saved ».
5. Tests : repository avec faux client (load absent → `undefined`, save → `createFiles` appelé, schéma futur intact, migration localStorage).
Vérif **[NAV]** avec mock : dessiner, recharger → présent ; fichier visible dans `listFiles`. Commit : `feat(design): persist the canvas in the workspace`.

### T16 [S] — Chevauchement change-bar/zoom et Snap honnête (S9)
Fichiers : `packages/app/src/pages/workbench/v110-design.css` (ou le CSS du studio : `grep -rn "data-design-studio-changebar" src --include=*.css`), `studio-dock.tsx`.
1. Changer la disposition : la change-bar et le zoom partagent une rangée flex (`gap`, `flex-wrap`), la change-bar passe en `compact` sous `--design-studio-width < 720px` (mesurer via `ResizeObserver` dans `design-canvas-tab.tsx`, remplacer le test `narrow()` limité au viewport pour ce seul cas). Le dock reste scrollable horizontalement (`overflow-x:auto`) au lieu d'être tronqué.
2. Snap : le moteur est **toujours actif** (`snapping.ts` utilisé par `canvas-adapter.ts`) → rendre l'indicateur statique (`<span>` sans `aria-pressed` ni `aria-disabled`, étiquette « Snap 8 px + guides ») pour ne plus laisser croire à un bouton.
Vérif **[NAV]** à 1440×900 avec Chat + Inspecteur : `changebar.right <= zoom.left`. Commit : `fix(design): the change bar and zoom no longer overlap`.

### T17 [S] — Accès Fichiers / Spec depuis Design
Fichier : `design-workshop-menu.tsx`, `design-surface.tsx` (`openTerminalTab`, `openBrowserTab` comme modèle). Ajouter deux entrées « Fichiers » et « Spec » qui ouvrent `openTab(tabState, {id:"files", kind:"file", …})` et `{id:"spec", kind:"spec", …}` (types déjà supportés par `renderTabContent`). Clés i18n `design.studio.workshop.files|spec`. Commit : `feat(design): reach Files and Spec from the workshop menu`.

### T18 [S] — Home : plus de faux champ ni de pastilles inventées (S7)
Fichier : `pages/home.tsx` (l.~156-176), `v110-home*.css`, i18n `home.ts`.
1. Supprimer les 3 `home-meta-pill` (Build / MiniMax-M3 / Default) et leur conteneur `home-composer-meta` (ou le laisser vide avec `display:none`). Ne pas remplacer par des valeurs inventées.
2. Transformer `<div data-v110="home-composer-input">` en `<button type="button" data-v110="home-composer-input" onClick={() => activate("code")}>` avec le même contenu (aspect identique via `all: unset` dans la règle CSS existante) pour que le clic ouvre le mode Code au lieu de ne rien faire.
Vérif **[NAV]** : cliquer la zone → route `/session`. Commit : `fix(home): the composer card opens Code and drops invented model chips`.

### T19 [S] — Orbe Live : pas de no-op silencieux
Fichier : `components/session/live-orb.tsx`, `voice/live-store.ts`. Quand `unavailable()` : `title` = clé i18n existante la plus proche (`grep -n "prompt.live" src/i18n/fr.ts`) ou nouvelle `prompt.live.unavailable` (« Ouvrez une conversation pour lancer Live ») ; au clic, `showToast` (composant toast du projet, `grep -rn "showToast" src | head -3`) au lieu d'ignorer. Commit : `fix(live): say why the orb cannot start instead of ignoring the click`.

### T20 [S] — Browser : états honnêtes et style v110
Fichier : `design-browser-tab.tsx`. Remplacer les boutons Tailwind bruts (`buttonClass`) par les classes/attributs v110 utilisés dans `design-toolbar` v110 (`data-v110="work-btn"`), afficher un message d'état lisible « Fenêtre native ouverte pour <url> » quand `label()` est défini, et enregistrer l'historique de session (liste des URLs ouvertes) publié à T14. Ne pas simuler d'onglets. Commit : `fix(browser): v110 controls and a real open-window state`.

---

## Phase 4 — P2 et code mort

### T21 [S] — Memory : textes en dur
`memory-panel.tsx` l.~748-905 : « Edit », « Preview », « Split », « Note », « Graph », « Hide vault », « Hide links », « Links », « Local graph », « Close » → clés `workbench.memory.*` existantes sinon nouvelles (tous les fichiers i18n). Commit : `fix(memory): translate the panel labels`.

### T22 [S] — Nettoyages ponctuels
1. `src/index.css` : supprimer l'un des deux `@import` de `v110-live-orb.css`.
2. `context/terminal.tsx` l.~236-481 : retirer les `console.log` `[term-investigation]` (vérifier qu'aucun test ne les lit).
3. `settings-audio.tsx` l.~84 : le sélecteur STT à une seule option → afficher la valeur en texte statique dans la ligne (pas de `Select` factice).
4. `settings-ai-preferences.tsx` l.~127 : idem pour le routage (garder désactivé mais sans `onSelect={() => undefined}` : passer `disabled` seul si le composant l'accepte).
Un commit par point.

### T23 [L] — Suppression du code mort vérifié (S10)
Pour **chaque** candidat : (a) `grep -rn "<stem>" packages --include=*.ts --include=*.tsx --include=*.rs --include=*.json` hors `node_modules` et hors le fichier ; (b) si seulement des tests/commentaires : supprimer le fichier **et** son test, corriger les commentaires qui le citent ; (c) `bun typecheck && bun test` ; (d) commit isolé `refactor(app): remove unused <name>`.
Liste (audit §J) :
- Composants : `components/mobile/message-input.tsx`, `components/mobile/nav-drawer.tsx`, `components/task-panel.tsx`, `components/workspace-tabs-bar.tsx`, `components/session/observer-badge.tsx`, `pages/session/session-mobile-tabs.tsx`, `pages/workbench-mode.tsx` (attention : `workbench-mode-loader.ts` reste, il est utilisé par `sidebar-shell.tsx`).
- Utilitaires : `hooks/use-collaborative.ts`, `hooks/use-mobile-layout.ts` (garder si `tokens/viewport.ts` l'importe — vérifier), `utils/ws-auth.ts`, `shell/v110-viewport.ts`, `tokens/semantic.ts`, `pages/workbench/composer-attachment.ts`, `design/runtime/render-model.ts`, `design/model/fixtures.ts` (utilisé par tests ? alors le déplacer sous `test/`), `components/team/refresh-policy.ts`, `pages/session/file-tab-scroll.ts`.
- **Ne pas supprimer** : tout `voice/*` du §J (peut servir côté Rust/mobile ; hors périmètre : ouvrir un ticket GitHub « voice pipeline non importé côté web » au lieu de supprimer). Ne pas supprimer les paquets sans consommateur (`browser-runtime`, `scheduler`… : décision produit).

### T24 [S] — Tickets pour le différé
Créer des issues GitHub (skill `github-triage`) : « Work : Run/Approve/Générer » ; « Automate : Test/fixture/→ Work » ; « Browser : onglets + `browser-runtime` » ; « Terminal : Problèmes/Sortie/Tests/Debug/Ports » ; « Code inspector : ajouter au contexte, tâches » ; « voice/* non importé côté web » ; « paquets sans consommateur ». Ne pas les implémenter.

---

## Phase 5 — Clôture

1. `cd packages/app && bun typecheck && bun test` (tout vert) ; `bun turbo typecheck --concurrency=1` racine.
2. Parcours **[NAV]** complet (avec mock pont) sur les 6 modes à 1440×900 et 390×844 : aucune donnée inventée ne subsiste (comparer avec `AUDIT-NON-CONNECTE…` §A, D, E, F, G, H) ; relancer les sondages de l'audit : `python scripts/scan_buttons.py` (boutons sans handler ne doivent plus contenir `home-meta-pill`, `mode-inspector-content:117`) et le script d'orphelins (doit tomber à la liste voice/paquets acceptée).
3. Mettre à jour `docs/audit/AUDIT-NON-CONNECTE-NEW-UI-2026-09-29.md` : colonne « Statut » (corrigé + SHA / différé + ticket).
4. Fin de session (règle globale) : `_memory/memory.md` du projet dans le vault + entrée `LOG.md`.

## Dépendances entre tâches
T1 → T2 (même fichier, T1 d'abord) · T4 → T5-T10 · T11 → T12-T14 · T5/T14 lisent le même `DesignCanvasTab` (faire T5 puis T14, puis T15, T16) · T20 avant T14 (historique Browser) · T23 en dernier. T3, T17-T19, T21-T22 sont indépendantes.

## Vérification bout en bout
- Unitaire : chaque tâche ajoute/adapte un test nommé `Composant_Scénario_Résultat`.
- **Régressions ciblées** : Automate — Run deux fois de suite, Stop pendant `running`, nœud ajouté puis Publish ; Design — dessiner → Inspecteur non vide → recharger → présent dans `listFiles` ; Memory/Work/Browser — Inspecteur vide sans données, jamais de valeur inventée ; Home — clic sur la carte ouvre Code.
- Aucun `aria-disabled` ajouté hors motif « bientôt » ; aucun bouton `<button>` sans handler (rescanner).
- Serveurs de test arrêtés, worktree propre, un commit par tâche.
