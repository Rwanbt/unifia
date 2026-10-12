<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Audit « non connecté / non fonctionnel » — branche `new-ui`

**Date** : 2026-09-29 · **Branche** : `new-ui` @ `f269f049de` (checkout `D:\App\unifia\_newui-studio`)
**Périmètre** : `packages/app/src` (shell, Home, Code, Work, Design, Automate, Browser, Memory, Paramètres, Compte).
**Méthode** : lecture du code de chaque surface + trois balayages automatiques (boutons sans handler, `aria-disabled`/`disabled`/« bientôt », modules jamais importés) + vérification au navigateur (serveur headless + Vite, 1440×900) des constats marqués **[VÉRIFIÉ]**.
**Niveaux de preuve** : **[VÉRIFIÉ]** = observé à l'exécution · **[LU]** = confirmé par lecture du code, non exécuté · **[SUPPOSÉ]** = déduit, à confirmer.

## Limites (à lire d'abord)

1. En web dev, le pont Workbench natif exige `UNIFIA_SERVER_PASSWORD` : **Work, Automate, Memory sont restés hors connexion** pendant la vérification. Tout ce qui concerne leur comportement connecté est **[LU]**, pas exécuté.
2. Aucun test sur l'exe desktop, ni sur téléphone (les constats mobile sont **[LU]**).
3. Le sondage « module jamais importé » repose sur un grep d'imports ; un import dynamique construit par chaîne ne serait pas vu. Les cas listés en §J ont été recoupés à la main.
4. Les contrôles « bientôt » (grisés, étiquetés) sont **volontaires** et conformes à la règle « pas de fonction factice » ; je les liste car ils sont non fonctionnels, pas parce qu'ils sont fautifs. Les vrais défauts sont marqués **P0/P1**.

Sévérité : **P0** = trompe l'utilisateur ou casse un parcours · **P1** = fonction annoncée mais inopérante · **P2** = finition · **SOON** = désactivé et étiqueté (honnête).

---

## Synthèse

| # | Sév. | Constat | Preuve |
|---|---|---|---|
| S1 | **P0** | L'onglet **Inspecteur** de droite est une maquette figée pour Work, Design, Automate, Browser, Memory, Paramètres, Compte : données inventées (« Vision produit.md », « Confidence 98 % », « Créer le nouveau design 64 % », « Controller: Unifia AI »), aucun lien avec l'état réel. | VÉRIFIÉ |
| S2 | **P0** | Le **panneau contextuel de gauche** de Design, Automate, Browser, Memory est une liste statique inventée (pages « Landing/Settings/Components », workflows « Issue triage · open / Release notes / Nightly tests », « Favoris 3 », « Téléchargements 1 »). Aucune rangée n'a de clic. | VÉRIFIÉ |
| S3 | **P0** | **Automate : la barre Run est à usage unique.** Après un Run (ou une annulation), l'état ne revient jamais à « idle » : Run reste grisé, Stop aussi (Stop n'est actif qu'en attente d'approbation). | LU |
| S4 | **P0** | **Automate : nœuds ajoutés, arêtes et positions ne sont ni sauvegardés, ni publiés, ni exécutés** tant qu'on n'a pas cliqué « Enregistrer » caché dans le menu Versions ; même alors, Run n'envoie que `{id, version, steps}`. | LU |
| S5 | P1 | **Design : le canevas n'est stocké que dans le `localStorage` du navigateur** (« web fallback store »). Ni fichier projet, ni serveur, ni agent, ni git. | LU + VÉRIFIÉ |
| S6 | P1 | **Design : la sélection du canevas n'atteint pas l'Inspecteur** (« Aucune sélection » alors qu'un nœud est sélectionné). | VÉRIFIÉ |
| S7 | P1 | **Home : la « zone de saisie » est un texte statique** et les pastilles « Build / MiniMax-M3 / Default » sont codées en dur, sans handler. | LU |
| S8 | P1 | **Browser** : pas d'onglets, pas de rendu dans le panneau (ouvre une fenêtre native séparée), inutilisable en web. `@unifia/browser-runtime` n'a aucun consommateur. | LU |
| S9 | P2 | Design à 1440 px avec Chat + Inspecteur ouverts : la change-bar (↶ ↷ Revert Checkpoint) chevauche la pastille de zoom (~50 px) et le dock d'outils est tronqué. | VÉRIFIÉ |
| S10 | P2 | 32 modules sans import de production (dont 5 composants UI) : code mort ou câblage jamais fait (§J). | LU |

## Statut des corrections (2026-09-29)

Exécution du plan `PLAN-EXECUTION-CORRECTIONS-NEW-UI.md`, détail et écarts dans `EXECUTION-LOG-CORRECTIONS.md`. Vérifié = observé dans le navigateur (serveur protégé par mot de passe, pont Workbench connecté) ; tests = tests unitaires verts (2062 tests, typecheck de tout le dépôt vert).

| # | Statut | Commit(s) | Vérification |
|---|---|---|---|
| S1 | Corrigé | `d2ada1d381` (mécanisme), `31b1007664` Design, `f433a03574` Automate, `e19a1a5c41` Memory, `db0a426149` Work, `7ce0a3f298` Browser/Paramètres/Compte, `1ff565b3b2` fixtures supprimées | Vérifié : Design (sélection → cotes réelles), Browser, Paramètres, Memory (note, tags, 2 liens, 1 rétrolien, bouton « Ajouter au contexte » qui bascule l'état réel). Work : carte vide honnête (aucun run dans le banc) ; carte run testée unitairement seulement. |
| S2 | Corrigé | `e60edac9b3`, `ecd76f80ad` Automate, `d3fc2008fd` Memory, `33c39078db` Design, `9ea541d167` Browser | Vérifié : Design, Browser, Memory (Notes 2 / Rétroliens 1), Automate (le workflow créé apparaît, compteurs d'exécutions). |
| S3 | Corrigé | `20adc6dab3` | Vérifié : après un échec (503 du runtime absent du banc) Run reste cliquable. Les transitions running → completed/cancelled sont couvertes par tests seulement : le runtime de workflow n'est pas actif dans le banc. |
| S4 | Corrigé | `d67871cdb3` | Vérifié : nœud ajouté → Publish actif, rechargement → nœud et brouillon restaurés. Limite : le runtime exécute les étapes en ligne droite et ignore les arêtes dessinées (ticket 3). |
| S5 | Corrigé | `f5fa054696` | Vérifié : migration du `localStorage` vers `.unifia/design/canvas.design.json`, rechargement avec `localStorage` vidé → le rectangle revient, un changement de visibilité écrit `"visible":false` dans le fichier. |
| S6 | Corrigé | `31b1007664` | Vérifié (voir S1). |
| S7 | Corrigé | `76476a040a` | Vérifié : champ = bouton, 0 pastille. |
| S8 | Différé | — | Ticket 4 (`DEFERRED-TICKETS-NEW-UI.md`). Ajout : l'historique des pages ouvertes (`9ea541d167`). |
| S9 | Corrigé | `789bd3b6e9` | Vérifié à 1440×900 : barre au-dessus du zoom (bas 820 < haut 828). |
| S10 | Partiel | `94be2f4690`, `020c462789`, `69bb88f20c`, `d8b653809d` | 11 modules supprimés ; 9 conservés et expliqués dans le journal (garde-fous, politique non câblée, e2e attendu). |

Autres constats :
- Orbe Live silencieuse : corrigé (`e2251a3e4a`, toast + infobulle).
- Textes Memory en dur : corrigé (`7f4e76ac39`) ; sélecteurs à option unique, logs `[term-investigation]`, double import CSS : corrigés (`468d6973e7`, `206729bdba`, `0a1df7b5cd`).
- **Faux positif** : « aucun accès à Fichiers/Spec depuis Design » (§D, marqué [LU, à confirmer]). Le menu Atelier liste Spec, Fichiers, Terminal et Navigateur (vérifié). Aucun changement de code.
- Messages de validation Automate en anglais dur : corrigé (`f696f9a259`).
- Différé sans modification : toutes les commandes « bientôt » (Work Run/Approve, Test Automate, → Work, onglets Terminal, compte) et les paquets sans consommateur, voir `DEFERRED-TICKETS-NEW-UI.md`. Les tickets GitHub ne sont **pas** créés (publication à valider par le propriétaire).

---

## A. Shell transverse

| Élément | État | Détail |
|---|---|---|
| Rail (7 destinations), bouton compte, réglages, ouvrir projet | Connecté | Handlers présents. Automate n'apparaît que si la capacité `workflow.run` est accordée (ADR-1041). |
| Topbar : bascule thème, toggles panneaux, Chat/Split/Editor, palette de commandes | Connecté | |
| **Orbe Live** | Conditionnel | Il ne démarre que si un compositeur a lié le runtime (`bindLiveRuntime`, seul appelant : `prompt-input/live-binding.ts`). Sans compositeur monté (Home, Paramètres, Compte), le clic est un no-op silencieux (`if (!runtime?.available) return`). [SUPPOSÉ pour ces routes, LU pour le code] |
| Popover statut, ligne « Auto » (onglet Compute) | SOON | `disabled` + `onClick={() => {}}` (`status-popover-body.tsx:360-368`). |
| **Inspecteur, onglet « Inspecteur »** (hors Code) | **Factice (P0)** | `mode-inspector-content.tsx:24-93` : `INSPECTOR_CARDS` est un dictionnaire de littéraux. `ModeInspectorSurface` ne reçoit que `mode`, jamais d'état. Les boutons « Verified ✓ » et « Remove context » (`:117`) n'ont pas de handler. Textes en dur, non i18n. |
| Inspecteur, onglets « Explorateur » et « Exécution » | Connecté | Arbre de fichiers réel ; spans d'observabilité réels. |
| Sections contextuelles gauche (Design, Automate, Browser, Memory) | **Factice (P0)** | `sidebar-panel-mode-sections.tsx:158-249` : `StaticSection` → `NavRow` sans `onClick`. Les sections Code et Work sont réelles. Section « Agents » de Work : toujours vide, compteur `0` codé. |
| `session-mobile-tabs.tsx`, `components/mobile/*`, `workspace-tabs-bar.tsx` | Mort | §J. |

## B. Home

| Élément | État |
|---|---|
| Carte « composer » (`home.tsx:156-166`) | **Texte statique** dans un `<div>`, pas un champ. |
| Pastilles Build / MiniMax-M3 / Default (`:168-176`) | **Sans handler**, libellés codés (nom de modèle inventé). |
| Boutons dossier, +, flèche | Connectés mais ne font que `activate("code")` (navigation), sans transmettre de saisie. |
| Récents, pastilles de mode, serveur | Connectés. |

## C. Code

| Élément | État |
|---|---|
| Chat, compositeur, éditeur, onglets fichiers, explorateur, barre de code (permission, symboles, split, commandes) | Connectés. `toggleAuto` ne fait rien sans `params.id` (session absente), sans retour visuel. |
| Barre d'état de l'éditeur | Partielle : branche, problèmes LSP, langage, agent. **Absents** : synchro ↑↓, badge LSP, encodage, fin de ligne, Ln/Col (choix documenté dans le code) ; aucun élément n'est cliquable. |
| Codelens Run/Debug/References, « → Work », prévisualisation, complétion IA | Absents. |
| Compositeur : puces de contexte Memory, bouton web | Absents (écarts B5/B7 de l'audit V5, toujours ouverts). |
| **Terminal (panneau bas)** | Terminal réel + Effacer/Fermer connectés. **SOON** : Problèmes (affiche un compteur mais liste inaccessible), Sortie, Tests, Debug, Ports, « ••• ». |
| **Inspecteur Code** | Connecté : LSP, problèmes, Git, fichiers, symboles, recherche, historique (restauration réelle). **SOON** : 4 tâches (check/test/run/lint), « Tests — », complétion (texte), Contexte → ajouter sélection/fichier/dossier/terminal (4 boutons), Recherche → « liés », Symboles (bouton grisé), Historique → Checkpoint / Comparer / Branche. |

## D. Work (pont non connecté en test → **LU**)

| Élément | État |
|---|---|
| Onglets Aperçu/Tâches/Tableau/Chronologie/Activité/Exécutions, « ＋ Tâche », menu artefacts, « Inspecter », « Démarrer un run », « Ouvrir Team » | Connectés (données Team réelles). |
| **SOON** (`work-cockpit.tsx:38-55`) | En-tête : « Auto Safe ▾ », « ✦ Plan IA », « ↶ Annuler » · par tâche : « ▶ » · « Prochaine action sûre » : « Policy », « Run » · Approbations : « Approve » · Mise à jour : « Générer ». |
| Carte Agents | Toujours vide (`count: 0` codé) ; le backend n'expose pas d'agents. |
| Statistique « Coût » | Codée `—`. |
| Tableau : poignée de glisser | Affiche « non pris en charge » (`work-board-panel.tsx`) : pas de changement de statut possible. |
| **Contradiction P0** | Inspecteur : « Créer le nouveau design · En cours · Designer · 64 % » alors que la surface indique `0 % · 0/0 tâches` **[VÉRIFIÉ]**. |

## E. Design

**Connecté** : outils Select/Pen/Ligne/Rectangle/Ellipse/Commentaire ; calques (renommer, œil, verrou) ; commentaires ; undo/redo ; Revert/Checkpoint ; zoom ; Présenter (plein écran) ; export JSON ; import de l'ancien croquis ; Actualiser ; bascule Aperçu/Source (JSON brut) ; rétractation et redimensionnement du panneau ; raccourcis V/P/L/R/O ; menu atelier (Terminal, Navigateur, onglets ouverts).

**SOON (14, [VÉRIFIÉ] via `aria-disabled`)** : Format d'affichage, Capture→chat, Inspecter, Annoter, Modifier, Vector SVG, Historique des versions, Partager, Audit Design, Actions page « ••• », « + Nouvelle page », Édition des nœuds (N), Crayon libre (B), Snap.

**Points précis**
- **Snap** : affiché « actif » (`aria-pressed=true` + `aria-disabled`) alors que le moteur de snapping existe et s'applique déjà dans `canvas-adapter.ts` : l'indicateur ne peut pas être basculé. [LU]
- **Pages** : une seule page, nommée `document.name` (« Canvas »). L'Inspecteur de gauche du shell en annonce trois (§A).
- **Design System (onglet)** : swatches en lecture seule issues du manifeste, aucune action d'application. [LU]
- **Persistance (P1)** : `createLocalStorageDesignDocumentRepository`, commentaire « the workspace authority replaces it later ». Effacer les données du site efface les designs. [LU]
- **Inspecteur** : « Aucune sélection » alors qu'un rectangle vient d'être créé et sélectionné (`data-design-canvas-selection="node-…"`). [VÉRIFIÉ]
- **Dock / pastille « AI Local Preview · Auto » / réglette Viewport** de la maquette : absents. Pas de bouton « → Work ».
- **Chevauchement** [VÉRIFIÉ] : à 1440 px avec Chat + Inspecteur, la change-bar (bord droit à 1019 px) passe sous le zoom (bord gauche à 969 px).
- **Onglets d'artefact / Fichiers / Spec** : câblés, mais la barre d'onglets était vide à l'ouverture [VÉRIFIÉ] et le menu atelier liste **Spec, Fichiers**, Terminal et Navigateur [VÉRIFIÉ après coup : la première version de ce rapport disait à tort qu'il n'y avait aucun accès direct]. Les puces de commentaire dans le compositeur n'ont pas été portées (note dans `design-surface.tsx`).
- Barre d'outils d'artefact, export HTML/PDF (PDF = impression navigateur, pas de rendu serveur), instantané, partage : connectés.

## F. Automate (**LU**, pont non connecté en test)

**Connecté** : menu workflows / nouveau workflow, Import JSON, Export JSON, Undo/Redo local, Versions (ouvrir un brouillon publié), Validate (JSON + graphe : cycles, branches), Run (avec flux d'approbation Allow/Deny), Annuler un run depuis l'onglet Runs, environnement (grants/approbations), zoom/fit, minimap (montée dans le canevas : le constat « jamais montée » de l'audit du 28/09 est périmé), bibliothèque de 14 familles (recherche, ajout).

**SOON** : Test, sélecteur de fixture, « → Work ». Onglet **Tests** du débogueur : toujours vide (pas de runtime de fixtures).

**Défauts**
- **S3 (P0)** `automate-surface.tsx:444-446` : `runState` renvoie `"running"` dès que `workflowState()` est non vide, et `setWorkflowState` n'est jamais remis à `undefined` (lignes 332, 338, 366, 381). Or `canStart` exige `"idle"` et Stop exige `"waiting-approval"` (`automate-studio-run-bar.tsx:83-84`). Conséquence : un seul Run par chargement de page ; « completed », « deny » et « cancelled » bloquent tous le suivant ; pas de Stop pendant `running`.
- **S4 (P0)** `graph()` (positions, arêtes, nœuds ajoutés) est un signal client. Il n'écrit dans le brouillon que via `saveCanonical` (menu Versions → « Enregistrer »). `canPublish = dirty()` compare `draftSource` au publié : ajouter un nœud ne rend **pas** Publish actif. `openDefinition` réinitialise `EMPTY_GRAPH` : changer de workflow perd le travail. Run n'envoie que `{id, version, steps}` (`:337`).
- **P1** L'inspecteur de nœud (lecture seule) s'ouvre dans une colonne de la surface, alors que l'Inspecteur de droite annonce « Cliquez sur un node… pour ouvrir ses propriétés ici » : ce message est faux. [VÉRIFIÉ pour le texte]
- **P2** Erreurs avalées : `updateWorkflow(runId,"cancel")…catch(() => undefined)` (`:615`, `:657`) ; textes de validation « Invalid JSON… » / « Missing or empty "id" »… en anglais codé (`run-bar.tsx:170-215`).
- Sans capacité `workflow.run`, la destination disparaît. Voir la note de mémoire *Gates need the production lease* : à vérifier sur le lease de production.

## G. Browser

| Élément | État |
|---|---|
| ← → ⟳ Aller, champ URL | Connectés à `open_design_browser`/`navigate_design_browser` (Tauri). Ils ouvrent **une fenêtre native distincte** ; le panneau reste vide (« Saisis une adresse… »). |
| Web / navigateur sans Tauri | `invoke` échoue → iframe de repli, bloquée par la CSP `frame-src 'self' data:` sur le paquet. |
| Onglets, « Nouvel onglet », commutateur d'appareil, contrôle IA/utilisateur, « AI Activity » | Absents (GAP-01). |
| Inspecteur (Controller « Unifia AI », Permissions « Allow », etc.) | **Factice** [VÉRIFIÉ] : aucune permission réelle derrière. |
| Panneau gauche (Aperçu local, Dépôt, Documentation, Historique 0, Favoris 3, Téléchargements 1) | **Factice**, sans clic [VÉRIFIÉ]. |
| `@unifia/browser-runtime` (Playwright) | Aucun import dans les paquets (vérifié par grep). Le pilotage IA du navigateur n'existe donc pas côté UI. |
| Style | Boutons Tailwind bruts, hors vocabulaire v110. |

## H. Memory (pont non connecté en test → **LU**)

`memory-panel.tsx` est le composant le mieux câblé : nouvelle note/dossier, renommer, déplacer, supprimer, glisser-déposer, sauvegarde, retour/avance, Edit/Preview/Split, Note/Graph, liens/backlinks, graphe local, tiroirs mobiles. Défauts : libellés en anglais codés (« Edit », « Preview », « Split », « Note », « Graph », « Hide vault », « Links », « Local graph ») ; panneau gauche (Notes, Graphe, Recherche, Rétroliens) **factice et sans clic** ; Inspecteur **factice** (§A).

## I. Paramètres et Compte

Toutes les pages sont montées (`dialog-settings.tsx`). Désactivés (SOON, `title="Bientôt"`) :

| Page | Contrôle |
|---|---|
| Préférences IA | 3 profils sur 4 (seul « manuel » actif) · « Local » et « Repli cloud » · **tout le routage par capacité** (sélecteurs `onSelect={() => undefined}`, mode technique) |
| Compute | Carte « Auto » (commutateur) · carte « Politique » entière · « Appairer » si `getRemoteAccess` absent |
| Réseau | Champ proxy · certificats |
| Sécurité | Verrouillage |
| Système | Diagnostics |
| Hooks | « Nouveau hook » · liste des hooks (`data-soon`) |
| Observabilité du chat | 7 domaines sur 24 sans effet : artifact, approval, browser, process, routing, policy, hooks (`WIRED_DOMAINS`) |
| Audio | Sélecteur de moteur STT : une seule option (« parakeet »), `onSelect` vide |
| Compte → Personnel | Restaurer la session · synchronisation |
| Compte → Sécurité | Validation · MFA · Passkeys · Récupération · « Révoquer les autres » |
| Compte → Organisations | Rejoindre / Créer (verrouillés, 4 boutons) |

## J. Code sans consommateur de production (grep d'imports)

- **Composants UI** : `components/mobile/message-input.tsx` (bouton pièce jointe sans handler), `components/mobile/nav-drawer.tsx`, `components/task-panel.tsx`, `components/workspace-tabs-bar.tsx` (seulement cité en commentaire), `components/session/observer-badge.tsx`, `pages/session/session-mobile-tabs.tsx`, `pages/workbench-mode.tsx` (`app.tsx:460` : « no longer reachable »).
- **Hooks/utilitaires** : `hooks/use-collaborative.ts`, `hooks/use-mobile-layout.ts`, `utils/ws-auth.ts`, `shell/v110-viewport.ts`, `tokens/semantic.ts`, `pages/workbench/composer-attachment.ts`, `design/runtime/render-model.ts`, `design/model/fixtures.ts`, `components/team/refresh-policy.ts`, `pages/session/file-tab-scroll.ts`.
- **Pipeline voix (non importé côté web)** : `voice/audio-processing-chain`, `fast-decision-off`, `fast-decision-rules`, `pocket-android-tts`, `resource-scheduler`, `streaming-stt-{fallback,mock,nemo,router}`, `tts-router-mock`, `turn-endpointing`, `wired-providers`, `eot-bench-corpus`. Ils peuvent être consommés côté Rust/mobile ; à confirmer avant de conclure à du code mort.
- **Paquets** `packages/*` sans aucun import externe : `browser-runtime`, `scheduler`, `artifact-store`, `media-runtime`, `capability-runtime`, `sandbox-drivers`, `generative-ui-dom`, `release-hardening`, `runtime-conformance` (les autres — `desktop`, `mobile`, `web`, `storybook`, `slack`, `enterprise`, `function` — sont des applications feuilles, attendues). En lien avec l'UI : `scheduler` (nœud « Schedule trigger » d'Automate) et `browser-runtime` (mode Browser).
- Autres : `src/index.css` importe `v110-live-orb.css` deux fois (signalé le 28/09) ; logs `[term-investigation]` de débogage dans `context/terminal.tsx:236-481`.

## K. Ordre de correction proposé

1. **S3** (Run à usage unique) : remettre `workflowState` à `undefined` en fin de run, autoriser Stop en `running` — petit correctif, gros effet.
2. **S1 + S2** : soit brancher l'Inspecteur et le panneau gauche sur l'état réel, soit les retirer / les marquer « bientôt » comme le reste de l'app — ils contredisent la règle « aucune fonction factice » et affichent de fausses données.
3. **S4** : écrire le graphe dans le brouillon à chaque édition (ou rendre `dirty` sensible au graphe) et l'envoyer au Run.
4. **S5/S6** : dépôt canevas dans le workspace (`.unifia/design/`) + exposer la sélection à l'Inspecteur.
5. **S7 + S9** puis §J : Home (vrai champ ou pastilles retirées), chevauchement Design, suppression du code mort.
