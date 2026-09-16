# MiniMax M3 — Acceptance Matrix (Phase 1, partial)

> **Statut** : Phase 1 PARTIAL — surface × viewport × state × interaction matrixe pour surfaces principales
> **Base** : M3-CAMPAIGN-BASELINE.md, BASE_SHA `9aabd75cd10ec4e9886424ee4420a4022199d871`
> **Mandat** : reproduction fonctionnelle, responsive et visuellement certifiee de la maquette v110
> **Source** : `Unifia-UI-UX-v110-PORT-READY-R1.html` (2.4 MB, 97 modules, frozen 2026-09-10)

---

## Conventions de la matrice

Pour chaque surface :
- **Surfaces canoniques** : panneaux, boutons, tabs, toggle, resize, drawer, modal, hover, focus, scroll, DnD, animation, etats vide/chargement/erreur
- **Viewports** : desktop-large (≥1360), desktop-compact (1024-1360), tablet-landscape, tablet-portrait (768-1024), mobile-landscape, mobile-portrait (≤599)
- **Etats** : default, hover, focus, active, disabled, loading, error, empty
- **Interactions** : click, double-click, keyboard (Tab/Enter/Escape), drag-and-drop, resize, scroll, focus-trap

---

## Surface : Shell global (TOUS modes)

| Surface | Viewport | Interaction | Source maquette | Runtime actuel | Status |
|---|---|---|---|---|---|
| Topbar (title + workspace + actions) | desktop-large | click buttons | `data-v110-topbar` | existe (extracted) | ✅ partiel |
| Topbar | mobile-portrait | show topbar | maquette mobile mockup | layout.tsx topbar mobile | ✅ partiel |
| Rail (mode nav 4 buttons) | desktop-large | click → switch mode | `data-v110-rail` mode nav | context/mode (4 modes) | ✅ partiel |
| Rail | desktop-compact | collapse mode label | maquette | mode.modes accessor | ✅ partiel |
| Rail | tablet-portrait | collapse | maquette | ? | ⚠️ à tester |
| Rail | mobile-portrait | hide, mobile-nav only | `data-v110-mobile-nav` | shell/v110-mobile-nav.tsx | ✅ partiel |
| Sidebar (WorkspaceSidebarContext) | desktop-large | open/close + hover-peek | inline JSX + 3 factories (Phase 49-50) | OK factories shipped | ✅ partial |
| Sidebar | desktop-compact | close on smaller | maquette | `state.peeked` | ✅ partiel |
| Sidebar | tablet-portrait | collapse, peek on hover | maquette | aim.move | ✅ partiel |
| Sidebar | mobile-portrait | hidden, drawer | maquette | mobile | ? | ⚠️ à tester |
| Inspector (3 tabs Explorer/Inspector/Execution) | desktop-large | click tab | `data-v110-inspector-frame` | v110-inspector-frame.tsx (TABS=["explorer","inspector","execution"]) | ✅ partiel |
| Inspector | desktop-compact | persist open/close | maquette | layout.inspector | ✅ partiel |
| Inspector | tablet/mobile | collapse by default | maquette | e2e `a3-responsive` — onglets Explorer/Inspector/Execution atteignables + panneau Memory triptyque/single sur les 5 familles | ✅ partial |
| Workspace (main content area) | all | scroll, focus, resize | inline JSX | session.tsx + workspace | ✅ partiel |
| Composer (bottom chat input) | desktop-large | type + send | `data-v110-composer` | SessionComposerRegion (extracted) | ✅ partiel |
| Composer | mobile-portrait | adapt to mobile | maquette mobile | composer mobile | ✅ partiel |
| Terminal (bottom panel) | desktop | show/hide, resize | `data-v110-terminal-panel` | terminal.tsx (v110 marker) | ✅ partiel |
| Toast region | all | show/hide | `[data-component="toast-region"]` | inline JSX in layout.tsx | ⚠️ à extraire (Phase 5) |
| Dialog (settings, etc.) | desktop | show + focus trap | `[role="dialog"]` | inline @unifia/ui/dialog | ✅ partiel |
| Hover-peek overlay (sidebar peek) | desktop-compact | mouse over rail | inline JSX | aim/disarm | ✅ partiel |

**Authority responsive** : `tokens/viewport.ts:classify()` → `shell/v110-store.ts:useViewport()` doit être la source unique. **Pas de breakpoint local** ailleurs.

---

## Surface : Chat + conversationnel modes

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Chat composer (textarea + send) | desktop-large | type + Enter send | `data-v110-composer` | SessionComposerRegion | ✅ partial |
| Chat composer | mobile-portrait | show keyboard, full-width | maquette | mobile adapter | ⚠️ à tester |
| Chat message timeline | desktop-large | scroll, jump-to-anchor | session timeline | SessionTimelineSection (Vague 3) | ✅ partial |
| Chat message timeline | mobile-portrait | compress, sticky composer | maquette | mobile mode | ⚠️ à tester |
| Chat followup dock | desktop | queue / send / edit | inline object in session.tsx | followupDock signal | ⚠️ à extraire (Vague 4) |
| Chat revert dock | desktop | items / restore | inline object in session.tsx | rolled()/reverting() | ⚠️ à extraire |
| Chat permission dock | desktop | grant / deny | SessionComposerRegion | permission logic | ✅ partial |
| Chat plan tab | desktop-large | show plan | conversation plan mode | agent `plan` (primary) + glyphe v16 + model control ; e2e `chat-agent-modes` | ✅ |
| Chat debate tab | desktop | show debate | debate mode | agent `debate` + DebateModelSelector réel (contrôle modèle remplacé) ; e2e `chat-agent-modes` | ✅ |
| Chat build tab | desktop | show build | build mode | agent `build` (default) + model control standard ; e2e `chat-agent-modes` | ✅ |
| Chat team tab | desktop | show team | team mode | agent `team` + TeamModelSelector réel + TeamPanel ; e2e `chat-agent-modes` | ✅ partial |
| Chat auto tab | desktop | show auto | auto mode | agent `auto` réel (primary, permission `*: allow`) — aucun fake ; e2e `chat-agent-modes` | ✅ |
| Chat prompt context meter (token ring) | desktop-large | hover → tooltip | composer context meter | usage ring + tooltip | ✅ partial |
| Chat prompt index (right rail) | desktop | hover → reveal | PromptIndex in session.tsx | PromptIndex component | ✅ partial (PromptIndex simplification noted in ADR-037) |

---

## Surface : Code mode (A4 v110 chrome)

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Editor (center pane) | desktop-large | type, scroll, format | `data-component="editor-pane"` | editor-panel.tsx + file-tabs.tsx — marqueur `editor-pane` monté (5.1), CSS v110 actif sur le CodeMirror réel ; refonte visuelle au-delà des marqueurs non livrée | ✅ partial |
| Editor tabs | desktop | click tab, close tab | `data-component="workspace-tabs-bar"` | WorkspaceTabsBar — marqueur `workspace-tabs-bar` monté + labels i18n (5.1) | ✅ partial |
| Explorer (file tree, left) | desktop-large | click file, expand folder | `data-component="file-tree"` | components/file-tree.tsx — valeur alignée `file-tree` (5.1, était `filetree`) ; CSS v110 actif | ✅ partial |
| Inspector (3 tabs) | desktop-large | click tab | covered in Shell section | v110-inspector-frame | ✅ partial |
| Inspector file tree | desktop | show files | inline in sidebar-panel | components/file-tree.tsx (`data-component="file-tree"`) — rendu dans session-side-panel | ✅ partial |
| Inspector git panel | desktop | show git status | sidebar-project sidebar-source-control | source-control.tsx | ⚠️ partial |
| Terminal (bottom) | desktop | show/hide, resize | `data-v110-terminal-panel` | terminal-panel.tsx — marqueur canonique monté (5.3), règle v110 (bordure `--border-base` + focus-within) prouvée gagnante dans la cascade par e2e | ✅ partial |
| Diagnostic markers | desktop | hover → message | inline editor pane | ❌ aucune implémentation (issue #96) — règle v110 `diagnostic-marker` dormante | ❌ MANQUE |
| Code lens | desktop | hover → action | editor pane | ❌ aucune implémentation (issue #96) | ❌ MANQUE |
| Inline AI suggestions | desktop | accept/reject | editor pane | auto-edit (double-clic → mode édition) réel ; suggestions inline absentes (issue #96) | ⚠️ partial |
| Code split (editor + inspector) | desktop-large | resize | inline editor pane | `data-v110="resize-chat"` Separator | ✅ partial |
| Git blame annotations | desktop | hover → blame | inline | ❌ aucune implémentation (issue #96) | ❌ MANQUE |
| Search/Replace | desktop | type + Enter | editor pane | `@codemirror/search` réel (`searchKeymap`) — e2e `editor-search` : Mod+F, matches surlignés, replace-all vérifié | ✅ |
| LSP diagnostics | desktop | hover → docs | editor pane | extensions LSP câblées (diagnostics/hover/F12 via `code-mirror-lsp`) ; vérification e2e conditionnée à un serveur LSP (non installé en CI) | ⚠️ partial |

---

## Surface : Work mode (A5 v110, plus avancé)

> **Audit Work (2026-09-14)** : les 6 vues de la maquette v65 (Overview/Tasks/Board/Timeline/Activity/Runs) existent toutes avec du contenu réel (`WorkViewSwitcher` + panneaux `work-*`), adossées à l'orchestration Team (`runs.refresh`, `details.tasks/gates`). La présentation v65 (grille de cartes Plan/Agents/Progression/Next safe action/Approvals/Project update, chip santé « Off track », sélecteur d'autonomie Ask/Assisted/Auto Safe/Auto/Custom, bouton « Plan IA », Undo local) n'a pas d'équivalent runtime → **#100** (décision de présentation, pas d'UI fabriquée). Le DnD Kanban reste bloqué par l'absence de capacité HTTP (#86).

| Surface | Viewport | Interaction | Source maquette | Runtime actuel | Status |
|---|---|---|---|---|---|
| Work surface (tabs) | desktop-large | switch tab | `data-v110-work-surface` | work-surface.tsx + work-view-switcher.tsx — 6 vues, chacune avec panneau réel (progress/next-action/plan/board/timeline/activity/runs) ; layout prouvé sur les 5 familles (e2e `work-responsive`, bridge mocké) et contenu vide honnête par onglet (e2e `work-team-panels`, plus de skip web depuis 12.5) | ✅ partial |
| Work health chip | desktop | view | `work65-health` | work-health-chip.tsx + work-health.ts (issue #100) — mapping réel run (`failed` → Off track) / tâche (`blocked` → At risk) / gate (`CHANGES_REQUESTED` → At risk), état vide = On track comme la maquette ; preuve e2e `work-team-panels` | ✅ |
| Work board (Kanban) | desktop-large | drag task, click card | maquette | work-board-panel.tsx — lecture réelle du plan ; pas de DnD de statut (aucune capacité HTTP) → #86 | ⚠️ partial |
| Work list | desktop-large | scroll, filter | maquette | work-plan-panel.tsx — liste des tâches du run actif (lecture réelle) | ⚠️ partial |
| Work run details | desktop | view logs | maquette | work-runs-panel.tsx + team.details — statut/gates/tâches réels | ⚠️ partial |
| Work team panels | desktop | click team member | maquette | work-team-panels.tsx + team components | ✅ partial |
| Work agent policy | desktop | configure | maquette | Aucun sélecteur d'autonomie Work (Ask/Assisted/Auto Safe/Auto/Custom) ; l'autonomie passe par les permissions par capability + le mode agent → décision #100 ci-dessous (divergence acceptée) | ❌ DIVERGENCE ACCEPTÉE |

**Note** : Work est relativement avancé. PRD-037 Vague 5 documente qu'on peut éviter de le réécrire (passe de parité précise uniquement).

### Décision #100 — présentation v65 Work (2026-09-15)

**Verdict : une ligne portée (chip santé), le reste acté en divergence.** Le
chip santé a été implémenté sur des faits runtime réels ; les autres lignes
n'ont pas de source de données ou de capacité de runtime, et les fabriquer
violerait le contrat de campagne.

| Ligne v65 | Sort | Preuve / raison |
|---|---|---|
| Chip santé `work65-health` (« On track » / « At risk » / « Off track ») | ✅ **PORTÉ** | `work-health.ts` (pur) + `work-health-chip.tsx` : run `failed` → Off track ; tâche `blocked` ou gate `CHANGES_REQUESTED` → At risk ; sinon On track (état vide inclus, comme la maquette). Preuve e2e `work-team-panels` (chip `data-work-health="ok"` affiché). |
| Grille de cartes (Plan/Agents/Progression/Next safe action/Approvals/Project update) | ❌ **DIVERGENCE ACCEPTÉE** | Les 6 vues existent en onglets avec les mêmes données réelles ; « Agents » (statut par rôle) et « Project update » n'ont aucune source runtime (pas d'agents nommés ni de texte de projet côté Team). L'Overview compose déjà Progression + Next safe action en cartes. Recomposer la grille exigerait d'inventer deux cartes. |
| Sélecteur d'autonomie (Ask/Assisted/Auto Safe/Auto/Custom) | ❌ **DIVERGENCE ACCEPTÉE** | Pas de surface de politique Work : l'autonomie réelle est appliquée par les permissions par capability + le mode agent du composer. Créer un sélecteur qui n'écrit rien = fake. |
| « ✦ Plan IA » | ❌ **DIVERGENCE ACCEPTÉE** | Le flux existe (prompt de chat Work) ; un bouton header le dupliquerait sans capacité nouvelle. |
| « ↶ Undo » local | ❌ **DIVERGENCE ACCEPTÉE** | Aucune sémantique d'undo Work (les mutations Team sont serveur : runs, gates, statuts). L'undo vit là où la mutation vit (éditeur/design). |
| « + Task » | ❌ **DIVERGENCE ACCEPTÉE** | Le formulaire de start-run existe (work-start-run, vue Runs) ; l'entrée est ailleurs, pas de story manquante. |
| DnD board (statut de tâche) | ⏸️ **BLOQUÉ #86** | Aucune capacité HTTP pour muter un statut ; ne pas construire avant #86 (AC de #100). |

---

## Surface : Design mode (A6 v110 — gros écart fonctionnel)

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Design layers panel | desktop-large | drag-reorder, toggle vis | maquette | `design/runtime/layers-panel.tsx` (ADR-039 #107) — vue pure du document canonique : ordre, sélection, visibilité, verrou ; l'ancien `design-layers-panel.tsx` a été supprimé (D7-G11) | ✅ |
| Design vector tools (select/rect/line/ellipse/bezier) | desktop-large | click tool, drag | maquette | création native complète : drag rect/ellipse/ligne (#109) + plume parité maquette (#113, HTML L23203/L23298) — clic = angle, clic-glisser = poignées Bézier symétriques (preview = vrai chemin), clic sur le premier point = fermeture (segment final explicite, pas de `Z`), Entrée clôt, Échap annule ; édition des nœuds sur sélection (#110/#111) | ✅ |
| Design canvas (real Sketch integration) | desktop-large | draw, select, edit | maquette | canvas natif Konva livré (#105-#107 : drag/resize/rotate + snapping + layers) ; l'iframe Excalidraw ne survit que dans l'onglet Croquis legacy jusqu'à #108 | ⚠️ partiel — natif livré, legacy à retirer |
| Design layers DnD (real reorder) | desktop-large | drag up/down | maquette | e2e `canvas-layers` (ADR-039 #107) — reorder + reparent réels qui réécrivent `childIds` (D7-G6) | ✅ |
| Design selection handles (8 points) | desktop-large | drag handle | maquette | transformer Konva (8 ancres + rotation) vérifié par e2e (#105) ; polylignes : ancres (#110) et poignées de courbe (#111) ; multi-sélection + marquee livrés (#112, e2e `canvas-multiselect`) : Maj/Ctrl-clic bascule, marquee sur l'AABB monde (préfère les descendants), outline par nœud, un drag de groupe = une entrée `translateNodes` ; pan = Espace-drag/milieu | ✅ |
| Design Bézier path | desktop-large | drag control points | maquette | ancres + poignées de contrôle éditables (#110/#111) : parseur M/L/C/Q, bornes serrées (extrema de Bézier), commandes `updatePoints`/`updatePath`, e2e drag de poignée + undo/redo + reload ; plume clic-glisser (poignées symétriques, HTML L23203) et fermeture `Z` → #113 ; mode « Node Edit » dédié de la maquette non repris (handles à la sélection, style Figma) | ⚠️ partiel |
| Design rotate transform | desktop-large | drag | maquette | transformer Konva, commit canonique + e2e (ADR-039 #105, gate D7-G4) | ✅ |
| Design resize transform | desktop-large | drag | maquette | transformer Konva, scale replié en width/height + e2e (ADR-039 #105, gate D7-G4) | ✅ |
| Design snap/grid | desktop-large | drag with snap | maquette | `runtime/snapping.ts` — arêtes/centres, seuil px écran ÷ zoom + e2e (ADR-039 #106, gate D7-G5) | ✅ |
| Design undo/redo | desktop | Ctrl+Z/Y | maquette | `model/history.ts` — 1 commande = 1 entrée, undo/redo clavier + e2e (ADR-039 #106, gate D7-G8) | ✅ |
| Design export | desktop | click | maquette | export hooks | ✅ partial (SVG export target noted in ADR-039 §5) |
| Design comments | desktop | add comment | maquette | comment-panel | ⚠️ partial (non traité par ADR-039 — à cadrer séparément) |

**Phase 7 critique** : Design canvas doit être réellement câblé au runtime, pas un iframe Excalidraw cosmétique. **Débloquée par ADR-039** (`docs/adr/ADR-039-canonical-design-document-runtime.md`, Accepted) : document canonique versionné possédé par Unifia, renderer Konva agnostique derrière un adapter (pas de React dans l'app SolidJS), autorité de stockage nommée (workspace/artifact ; localStorage = repli web temporaire), validation zod, `LineNodeV1`/`PathNodeV1` pour les lignes vectorielles.

**État des slices au 2026-09-15** : **#104** domaine canonique livré (43 tests) ; **#105** canvas natif livré (D7-G3/G4, e2e drag/resize/rotation) ; **#106** interactions livrées (D7-G5/G8, e2e snap + undo/redo + nudge) ; **#107** layer runtime livré (D7-G6/G7/G11, e2e visibilité/verrou/reorder/reparent) avec suppression des modèles parallèles orphelins (`design-layers-model.ts`, `design-layers-panel.tsx`, `design-vector-tools.tsx`). **Reste #108** (D7-G9/G10 : import legacy + retrait iframe) et la reconstruction des outils vectoriels (sélection multi-points, poignées, Bézier) sur le canvas canonique.

**État des slices au 2026-09-16** : **#109** outils vectoriels de création livrés ; **#110** édition d'ancres de polylignes livrée (parseur M/L, `updatePoints`) ; **#111** édition des courbes livrée (parseur M/L/C/Q, bornes serrées par extrema, `updatePath`, poignées de contrôle tetherées, e2e drag + undo/redo + reload ; resize interdit sur les polylignes rotatives pour ne pas casser l'appariement transform/données) ; **#112** multi-sélection livrée (Maj/Ctrl-clic avec invariant conteneur/descendants, marquee AABB préférant les descendants, commandes groupées `translateNodes`/`deleteNodes`, pan Espace/milieu, dessin synchrone après rebuild pour un hit-test immédiat ; e2e `canvas-multiselect`). Restent : plume Bézier clic-glisser + fermeture `Z` (**#113**), parité visuelle Phase 8.

---

## Surface : Automate mode (A7 — P1 ABSOLU)

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Automate library (left) | desktop-large | drag node to canvas | maquette | automate-studio-library.tsx (slice 5) — 15 NodeFamily types grouped + search + click→add | ✅ |
| Automate canvas (center, node graph) | desktop-large | drag node, connect port | maquette | automate-studio-canvas.tsx (slice 1 + 4) — SVG nodes + pan/zoom + port connectors + drag-to-move | ✅ |
| Automate Inspector (right) | desktop-large | open on node click | maquette | automate-studio-inspector.tsx (slice 2) — id + label + position + approval + coordinates + edges sections | ✅ |
| Automate node library | desktop-large | browse, filter | maquette | automate-studio-library.tsx (slice 5) — DEFAULT_LIBRARY_CATEGORIES + filter input | ✅ |
| Automate run bar (bottom) | desktop-large | start/stop/test/validate | maquette | automate-studio-run-bar.tsx (slice 6) — Start + Approve + Validate dry-run + state chip + Save (slice 7) | ✅ |
| Automate ports (input/output) | desktop | drag connect | maquette | automate-studio-canvas.tsx (slice 4) — input/output circles + drag-port-to-port + click-to-delete | ✅ |
| Automate zoom/pan | desktop-large | Ctrl+wheel / drag | maquette | automate-studio-canvas.tsx (slice 1 + 9) — Ctrl/Cmd + wheel zoom, pointer drag pan, zoom-to-fit button | ✅ |
| Automate minimap | desktop-large | navigate | maquette | automate-studio-minimap.tsx (slice 9) — bottom-right corner, viewport indicator tracking pan/zoom, click→onJumpTo | ✅ |
| Automate debug (Runs/Data/Logs/Tests/Problems) | desktop | switch tabs | maquette | Recent runs section (partial) | ⚠️ partial — Runs only |
| Automate environment | desktop-large | configure | maquette | automate-studio-environment.tsx (Phase 9.1, 2026-09-13) — read-only pane: grants (active/inactive), workspace id, pending approvals, recent runs | ⚠️ partial — read-only overview; configure has no runtime endpoint |
| Automate publish/import/export | desktop | click | maquette | Local draft + Publish as new file (partial) | ⚠️ partial — Publish only |
| Automate branches | desktop | switch | maquette | automate-studio-canvas.tsx (Phase 9.2) — labelled true/false ports on control.if + kind-tagged edges + cycle/duplicate validation | ✅ |

**Phase 8 critique** : Automate doit devenir le vrai studio node-based. C'est le plus gros écart fonctionnel. **P1 absolu**.

**Phase 8 closure** (49 commits M3 cumulés, ~22-26h) :
- 7/12 surfaces Automate shipped (library, canvas, Inspector, node-library, run-bar, ports, zoom/pan, minimap).
- 3/12 surfaces still partial : debug-tabs (Runs only), publish/import/export (Publish only), environment + branches (Phase 9+ scope).
- Acceptable trade-offs :
  - **Debug tabs** : the maquette shows 5 tabs (Runs/Data/Logs/Tests/Problems) for full observability. Slice 6 shipped the Runs section as a minimum-viable proof that workflow runs are surfaced. The 4 remaining tabs are a Phase 9+ scope item (observability sub-suite).
  - **Publish/import/export** : slice 7 shipped `Save` (writes canonical v2 to local draft) + `Publish as new file` (writes to runtime via `publishDraft`). Import/Export (full JSON workflow file exchange) are Phase 9+ scope items.
  - **Environment / branches** : explicitly marked Phase 9+ scope in the matrix. These are workflow-execution-environment concerns, distinct from the studio visual work that Phase 8 was scoped to.

**Phase 9 continuation (2026-09-13)** : the two `Phase 9+ scope` lines shipped as Phase 9.1 (environment read-only pane, commit `f061fff246`) + Phase 9.2 (branch true/false ports + graph validation, commit `701306f06a`). Remaining Automate gaps : debug tabs (Runs only) and publish/import/export (Publish only).

**Phase 12.6 (2026-09-15)** : responsive du studio certifié sur les 5 familles (`e2e/v110/automate-responsive.spec.ts`) — canvas ↔ step list selon la classification edge (viewport), librairie en accordion sur overlay, run bar + inspecteur atteignables, sélection de nœud fonctionnelle. Le mock bridge sert désormais une définition réelle (`fileContents` → `readFiles`) au lieu de l'état vide.

---

## Surface : Memory mode (A7)

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Memory vault (left) | desktop-large | click note | `data-memory-vault` | memory-panel.tsx | ✅ partial |
| Memory note pane (center) | desktop-large | edit, scroll | `data-memory-note-pane` | memory-panel.tsx | ✅ partial |
| Memory links + graph (right) | desktop-large | hover link, pan graph | `data-memory-links` | memory-panel.tsx | ✅ partial |
| Memory hover preview | desktop | hover linked note | tooltip `title=` attr | memory-panel.tsx (Phase 10) | ✅ partial |
| Memory mobile single-pane | mobile-portrait | tap to navigate | maquette mobile | memory-panel.tsx (Phase 9) — canonical viewport authority collapses the triptych to one pane + tap-to-navigate + back nav ; contrat vérifié sur les 5 familles (e2e `a3-responsive`, 12.1) | ✅ |
| Memory folder tree | desktop | expand/collapse | maquette | memory-panel.tsx (9.3) — `buildMemoryTree` folders-first + subtree counts + collapse carets | ✅ |
| Memory DnD notes | desktop | drag to folder | maquette | memory-panel.tsx (9.3) — HTML5 DnD → `WorkbenchClient.renameFile` (réel `/v1/files/rename`) + auto-expand 620 ms + e2e `memory-vault-dnd` | ✅ |
| Memory context actions | desktop | right-click | maquette | memory-panel.tsx (9.5) — menu note (open/rename inline/duplicate/move/export/delete) + dossier (new note/sub-folder) via routes réelles ; rename réécrit les wikilinks non ambigus (#93, e2e `memory-rename-links`) ; pin/archive absents (pas de capacité runtime) ; e2e `memory-note-actions` | ✅ |
| Memory autosave | desktop | debounced | maquette | memory-panel.tsx (9.4) — debounce 700 ms (`AUTOSAVE_DELAY_MS`) vers `file.write` CAS + flush avant navigation + chip Saved/Saving…/Unsaved ; e2e `memory-note-autosave` | ✅ |
| Memory wikilinks | desktop | type [[ | maquette | parseMemoryNote (model) + refactor au renommage (#93, `rewriteMemoryWikilinks` : cibles non ambiguës `[[Ancien]]`/`[[Ancien|alias]]`/`[[Ancien#section]]` réécrites sur fichiers réels avec CAS par fichier, échecs partiels remontés ; e2e `memory-rename-links`) | ✅ |
| Memory graph pan/zoom/fit | desktop-large | drag/wheel/dblclick | maquette | livrés : drag = pan (curseur grab/grabbing, nodes cliquables préservés), molette = zoom ancré au curseur clampé 0.55-1.8 (plage m69 partagée via `memoryGraphFit`), double-clic = fit déterministe sur la bbox d'un groupe non transformé ; refit auto au changement de contenu ; e2e `memory-graph-pan-zoom` | ✅ |
| Memory graph depth/tags/orphans | desktop | filter | maquette | memory-panel (9.6) — depth 1-3 (défaut 2), anneau tags (8 max, 3 arêtes/tag), filtre orphans, résumé notes/liens ; e2e `memory-graph-filters` | ✅ |

**Phase 9** : mobile single-pane LIVREE (`46aa98c9c3`) ; folders + DnD notes LIVRES (slice 9.3, `b474fe7463`).

---

## Surface : Browser mode

> **Runtime check 2026-09-13** : le WebView réel n'expose qu'une fenêtre (address/back/forward/reload). Tabs Brave-like, device switch, contrôle AI/user et AI Activity n'ont **aucun runtime** — issue #97 ; les labels du composant sont aussi codés en dur en français. Ne pas cocher ces lignes sans preuve runtime.

| Surface | Viewport | Interaction | Source maquette | Runtime | Status |
|---|---|---|---|---|---|
| Browser tabs | desktop-large | click tab | maquette | browser-runtime | ⚠️ partial |
| Browser address bar | desktop-large | type URL, Enter | maquette | browser-runtime | ⚠️ partial |
| Browser back/forward/refresh | desktop-large | click button | maquette | browser-runtime | ⚠️ partial |
| Browser AI Activity | desktop | view | maquette | ? | ⚠️ à tester |
| Browser clear/takeover | desktop | click | maquette | ? | ⚠️ à tester |
| Browser device controls | desktop | toggle | maquette | ? | ⚠️ à tester |
| Browser home/Brave/GitHub | desktop | click | maquette | browser-runtime | ⚠️ partial |
| Browser mobile navigation | mobile-portrait | tap | maquette mobile | ? | ⚠️ à tester |

**Phase 10 critique** : Browser doit gérer le bug historique flash/changement de mode.

---

## Surface : User / Settings

> **Audit Phase 11 (2026-09-14)** : la sidebar de la maquette a 17 destinations ; le runtime livre le sous-ensemble adossé à une capacité réelle (12 onglets desktop). Gate e2e `v110/settings-parity.spec.ts` : chaque onglet monte sa pane et expose des contrôles réels (1/1 PASS, 49.8 s). Les destinations maquette **sans capacité runtime** (Préférences IA, Compute, Sécurité consolidée, Réseau, Système/diagnostic, Hooks) sont tracées sur **#98** — pas d'UI fabriquée. Statut ⚠️ = câblé réel mais preuve e2e comportementale absente ; ✅ = e2e comportemental nommé.

| Surface | Viewport | Interaction | Source maquette | Runtime actuel | Status |
|---|---|---|---|---|---|
| Settings dialog (Général) | desktop-large | click tab | maquette | settings-general — langue/thème/polices/notifications/sons/mises à jour réels (settings context + localStorage) ; e2e `settings.spec.ts` 19 tests + gate parité | ✅ |
| Settings dialog (Audio) | desktop | click | maquette | settings-audio — STT/TTS persistés localStorage ; preuve comportementale : bascule des deux switches + reload conservé (e2e `settings-behavior`) ; gate parité | ✅ |
| Settings dialog (Mémoire) | desktop | click | maquette | settings-memory — lecture/écriture `sdk.client.global.config` ; preuve comportementale : switch enable → PATCH `/global/config` vérifié puis restauré (e2e `settings-behavior`) ; gate parité | ✅ |
| Settings dialog (Compute) | desktop | click | maquette | settings-configuration (accélérateur/backend/engine — réel) ; la page maquette « Compute » (local/distant/pairing) n'a aucune capacité runtime → #98 | ⚠️ partial |
| Settings dialog (Observabilité) | desktop | click | maquette | settings-observability — ressources SDK réelles (settings/exporters/health/sessions/events/summary/compare) ; preuve comportementale : switch enable → `experimental.observability` écrit via `/global/config` puis restauré (e2e `settings-behavior`) ; gate parité | ✅ |
| Settings dialog (Fournisseurs) | desktop | click | maquette | settings-providers — e2e `settings-providers.spec.ts` 4 tests + gate parité | ✅ |
| Settings dialog (Benchmarks) | desktop | click | maquette | settings-benchmark — exécution réelle Tauri (platform-gated, absente du build web) ; preuve comportementale web : run désactivé sans runtime local (aucun résultat fabriqué) + historique localStorage rendu/effacé (e2e `settings-behavior`) ; gate parité | ⚠️ partial |
| Settings dialog (Android) | desktop | click | maquette | settings-android — platform-gated (non exerçable en CI desktop) | ⚠️ partial |
| Settings dialog (Plugins) | desktop | click | maquette | settings-plugins — Skills réel (`app.skills`, `/skill/install`) ; MCP : pane atteignable (#101) et **CRUD persistant** depuis #102 (`updateGlobal` + `Config.unsetGlobal`), preuve e2e `settings-behavior` (ajout UI + `GET /mcp` → suppression) ; Hooks absent → #98 | ✅ (MCP) / ⚠️ (Hooks) |
| Settings dialog (Remote Access) | desktop | click | maquette | settings-remote-access — réel mais desktop-gated (`platform.getRemoteAccess`) : pane vide dans le build web e2e | ⚠️ partial |
| Settings dialog (Collaborative Auth) | desktop | click | maquette | settings-collaborative-auth — formulaire réel (`/collab/login`) ; preuve comportementale : le formulaire poste vers la route réelle et expose le 401 backend (e2e `settings-behavior`) ; gate parité | ✅ |
| User Account / Sign-in / Sign-up | desktop-large | submit | maquette auth | inline | ⚠️ partial |
| User Connect Provider | desktop | click | maquette | inline | ⚠️ partial |
| User Connect Local LLM | desktop | configure | maquette | inline | ⚠️ partial |

**Phase 11 critique** : tous les controls doivent modifier réellement le runtime/config.
**Bilan audit 2026-09-14** : les 12 onglets runtime sont câblés à des capacités réelles (localStorage, settings context, `global.config`, SDK observabilité, MCP/skills) ; les contrôles maquette sans capacité (routing IA, compute, sécurité consolidée, réseau, diagnostic, hooks) sont hors fabrication → #98. Prochaine étape Phase 11 : durcir les preuves comportementales (e2e par onglet) et statuer #98.
**Bilan durcissement 2026-09-15 (fin Phase 11)** : preuves comportementales nommées pour Audio, Mémoire, Observabilité, Benchmark (contrat web) et Auth (e2e `settings-behavior`, CI run `34952975362`) ; MCP persistant (#102) ; #98 statué (divergences acceptées, ci-dessous). Restent ⚠️ les lignes platform-gated (Benchmark exécution Tauri, Android, Remote Access) — non exerçables dans le build web.

### Décision #98 — destinations maquette sans capacité runtime (2026-09-15)

**Verdict : divergences acceptées et documentées.** Les 6 destinations de la
maquette absentes du runtime (Préférences IA, Compute, Sécurité, Réseau,
Système, Hooks) reposent sur des capacités qui n'existent pas dans le runtime ;
les fabriquer violerait le contrat de campagne (« fonction absente backend →
pas de fake »). Chaque ligne est tracée ci-dessous avec ce qui a été vérifié.
Une implémentation future exige un PRD définissant la surface de config **et**
son consommateur runtime — pas un portage UI.

| Destination maquette | Capacité runtime vérifiée | Verdict |
|---|---|---|
| Préférences IA (`routing91` : profils Privé/Équilibré/Qualité/Économie, « local quand pertinent », « secours cloud », routage par capacité, mode manuel) | Aucun routeur par préférence. `config.model` existe (`Provider.defaultModel()`, `packages/unifia/src/provider/provider.ts:922`) mais la page maquette ne l'expose pas comme un simple sélecteur : profils + toggles + routage par capacité n'ont aucun consommateur | ❌ DIVERGENCE ACCEPTÉE — si le produit veut un « modèle par défaut », c'est une capability `config.model` (réelle) à cadrer en PRD séparé |
| Compute (`compute32` : registre d'appareils, auto-routing, wizard de connexion) | Aucun registre de compute nodes exposé à l'app ; `settings-configuration` couvre l'accélérateur/backend local (autre sujet) | ❌ DIVERGENCE ACCEPTÉE (backlog produit) |
| Sécurité (`security91` : confirmation actions sensibles, secrets verrouillés session, connexions/clés, permissions techniques) | Le système de permissions existe (`permission.external_directory`, ask/allow/deny par outil) mais : aucun « verrouillage secrets » de session, la sémantique « confirmer les actions sensibles » ne mappe pas sur les règles par outil, et « Connexions et clés » vit déjà dans Fournisseurs (réel). Pas de destination consolidée | ⚠️ DIVERGENCE ACCEPTÉE — les capacités réelles existent ailleurs (Fournisseurs, config `permission`) ; pas de regroupement fabriqué |
| Réseau (`network91` : proxy HTTP(S), certificats d'entreprise) | Aucune surface de config proxy/CA dans l'app (Bun lit l'environnement, non exposé) | ❌ DIVERGENCE ACCEPTÉE |
| Système (`system91` : mises à jour, diagnostic, export/import) | Mises à jour réelles dans Général (`platform.checkUpdate`, `settings-general.tsx:162`), export/import config réels (`ConfigExportImport`, `settings-general.tsx:33`) ; pas de diagnostic consolidé (Observabilité expose déjà santé/événements réels) | ⚠️ DIVERGENCE ACCEPTÉE — capacités existantes ailleurs, destination non dupliquée |
| Hooks (`hooks49` : lifecycle events + formulaire) | Les hooks existent au niveau **API plugin** (code), pas de config JSON de hooks dans le runtime | ❌ DIVERGENCE ACCEPTÉE (l'extension passe par les plugins) |

**Conséquence campagne** : le gate de parité Settings couvre les 12 onglets
runtime ; les 6 destinations ci-dessus ne sont pas des ❌ de portage mais des
absences produit assumées. Issue #98 fermée (not planned) avec cette décision.

---

## Viewport matrix (à appliquer à toutes les surfaces)

| Viewport | Width | Height | Comportement attendu |
|---|---|---|---|
| desktop-large | ≥1360 | variable | full shell, all sidebars visible |
| desktop-compact | 1024-1360 | variable | shell compact, peek behavior |
| tablet-landscape | 900-1360 | ≤900h | rail compact, sidebars collapse |
| tablet-portrait | 768-1024 | variable | mobile-nav + drawer sidebars |
| mobile-landscape | ≤1024 | ≤560 | bottom-nav + drawer |
| mobile-portrait | ≤599 | variable | bottom-nav + drawer, single-pane |

**Bug historique** : tablet-portrait et mobile-landscape produisent les superpositions les plus difficiles. **Phase 12** doit les tester systématiquement.

---

## Anti-régression checklist (à valider avant Phase 18)

- [ ] Aucun bouton mort trouvé dans aucun mode
- [ ] Aucun mock ajouté pour combler un écart maquette
- [ ] Aucun breakpoint local concurrent de l'autorité responsive
- [ ] Aucun panneau/Inspector dupliqué
- [ ] Aucune action masquée sur mobile sans workflow alternatif
- [ ] Aucune capacité réelle du runtime cassée par le port
- [ ] Phase 17 cleanup lancée SEULEMENT après parité (PAS avant)

---

## Prochaine étape

**Phase 2** : helpers Playwright déterministes (session launch, mode switch, sidebar toggle, viewport change, overflow/focus/screenshot assertions). Aucun test ne boucle sur plusieurs viewports dans une même session.

---

*Matrice partielle 2026-09-13 — Phase 1 PARTIAL. Compléter dans sessions suivantes au fur et à mesure que les surfaces sont portées.*
