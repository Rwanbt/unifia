<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Audit de parité UI — app `new-ui` vs prototype V5 (PC + mobile)

**Date** : 2026-09-28 · **Branche** : `new-ui` @ `82ab69ba01`
**Référence** : `Unifia-UI-UX-v110-JARVIS-TOPBAR-PROTOTYPE-V5.html` (= R1 + orbe Jarvis)

## Méthode et limites

- Captures côte à côte maquette | app, thème sombre, à 1440×900 et 390×844 (iPhone 13), pour les 11 états : accueil, Code (Chat / Split / Editor), Work, Design, Automate, Browser, Memory, Paramètres, Compte. Captures ciblées en plus : éditeur avec un fichier ouvert, onglet Canvas de Design, thème clair (Work). Scripts : `packages/app/tmp/parity/_audit*.mts`.
- **Limite 1** : l'app tourne en web dev (Vite 4448 + backend 4099). Le pont Workbench natif y échoue (« invalid handshake response »). Work, Automate et Memory sont donc vides ou en état d'erreur. Tout ce qui dépend de ce pont est marqué **[à vérifier desktop]** : il faut le confirmer sur l'exe desktop avant de corriger.
- **Limite 2** : la maquette affiche des données de démo (Prism EQ, notes, runs) ; l'app affiche les vraies. Un contenu différent n'est pas un écart. Seuls comptent la structure, le style et le parcours.

## Différences volontaires à conserver

Ce ne sont pas des écarts à corriger :

- **Décision #98** : Préférences IA, Compute, Sécurité, Réseau, Système et Hooks n'ont que les capacités réelles, sans rien de fabriqué.
- **ADR-039** : sélection Design (clic, Maj+clic, marquee, pan).
- **ADR-053** : carte Chat décalée de 2 px ; tablette portrait.
- **ADR-058** : paramètres mobiles en navigation par liste.
- **Pastilles du compositeur** (agent, modèle, permission) : design propre à l'app.
- **Libellés i18n** (« Vous » au lieu de « User »).
- **Orbe Live** : ON/OFF seulement, sans panneau de survol. Le Live réel est sur `voice`.
- **Menu Compte** : pas de « Verrouiller Unifia », l'app n'a pas d'écran de verrouillage.
- **Bouton Aide** : retiré du tiroir mobile.
- **Sélecteurs de formulaire** : tous au style « settings » (demande explicite du 2026-09-27), y compris « Pour », que la maquette rendait en `<select>` natif de 126 px.

## Écarts constatés

Sévérité : **P0** = parcours cassé ou surface inutilisable · **P1** = écart visible sur un parcours courant · **P2** = finition · **GAP** = capacité runtime absente (portage visuel impossible sans backend).

### A. Shell et navigation

| # | Sév. | Viewport | Écart | Preuve |
|---|---|---|---|---|
| A1 | **P0** | PC + mobile | Entrer dans Work, Design, Automate, Browser ou Memory alors que la vue est « Chat » n'affiche que le chat : la surface du mode reste cachée. La maquette ouvre ces modes en Split, surface visible. Le choix Chat/Split/Editor est aussi partagé entre les modes (un Editor choisi dans Code reste actif dans Work). | `light-work-pair`, `desk-work-pair` |
| A2 | P1 | PC | Topbar, bouton serveur : la maquette affiche une pastille texte « ● Auto · 2 » (cible compute et nombre de serveurs). L'app n'a qu'une icône avec un point. | `desk-code-pair` |
| A3 | P1 | PC | Topbar de l'accueil : la maquette montre la flèche du rail, le logo, l'orbe, la pastille serveur et le thème. L'app montre les boutons panneau gauche et inspecteur (sans objet sur l'accueil), mais ni l'orbe ni la pastille serveur. | `desk-home-pair` |
| A4 | P1 | mobile | Topbar de l'accueil : la maquette n'a que l'orbe au centre. L'app garde les deux boutons de panneau. | `mob-home-pair` |
| A5 | P1 | mobile | Paramètres et Compte : la maquette cache le switch Chat/Editor (seulement le bouton gauche, l'orbe et l'inspecteur). L'app le garde. | `mob-settings-pair`, `mob-user-pair` |
| A6 | P1 | PC + mobile | Memory : la maquette place un switch « Note / Graph » dans la topbar, à côté de l'orbe. Il est absent de l'app. | `desk-memory-pair`, `mob-memory-pair` |
| A7 | P2 | mobile | Switch Chat/Editor : l'option active de l'app a un contour clair et le conteneur une bordure. Dans la maquette, l'option active est un aplat sans contour. | `mob-code-pair` |
| A8 | P2 | PC | Avatar du rail : la maquette montre l'initiale (« U ») dans un cercle ; l'app une icône personne. | `desk-code-pair` |
| A9 | P2 | PC + mobile | Accueil : les récents affichent des chemins bruts (`D:\App\unifia\unifia`, `~`, `~\AppData\…`). La maquette montre des noms de projet avec leur mode (« Prism EQ · Code »). | `desk-home-pair`, `mob-home-pair` |
| A10 | P2 | mobile | Surfaces de mode : sur téléphone, l'app garde la carte arrondie et bordée, en retrait de 3 px. La maquette est à plat, bord à bord (Paramètres, Compte, Memory). | `mob-settings-pair`, `mob-user-pair` |

### B. Code : éditeur et chat

| # | Sév. | Viewport | Écart | Preuve |
|---|---|---|---|---|
| B1 | P1 | PC + mobile | Éditeur sans fichier : un seul texte, « Aucun fichier ouvert ». La maquette garde la barre d'onglets, la barre d'outils, la barre d'état et le bouton terminal. | `desk-editor-pair`, `mob-editor-pair` |
| B2 | P1 | PC | Barre d'état incomplète (branche, langage, agent). La maquette a en plus la synchro ↑↓, les problèmes ×!, le badge LSP, l'encodage, la fin de ligne et Ln/Col. | `desk-file-pair` |
| B3 | P1 | PC + mobile | Pas de bouton terminal en bas à gauche de l'éditeur (bouton flottant sur mobile). | `desk-file-pair`, `mob-editor-pair` |
| B4 | P2 | PC | Pas de bouton « → Work » à droite des onglets de l'éditeur. | `desk-file-pair` |
| B5 | P2 | PC | Pas de codelens « Run · Debug · References » au-dessus des symboles. **Hypothèse** : fonction LSP à cadrer ; ne rien ajouter sans consommateur réel. | `desk-file-pair` |
| B6 | P2 | mobile | Barre d'outils mobile : la maquette a des pastilles « Perm · Auto » et « AI · Auto » plus quatre icônes (symboles, split, preview, commandes). | `mob-editor-pair` |
| B7 | P2 | PC + mobile | Compositeur : la maquette a une ligne de puces de contexte Memory (« Memory · 3 », notes attachées) et un bouton web (globe). L'app a Confidentialité et Micro. **À cadrer** : l'attachement de notes Memory a-t-il un consommateur runtime ? | `desk-code-pair` |

### C. Work

| # | Sév. | Viewport | Écart | Preuve |
|---|---|---|---|---|
| C1 | **P0** | mobile | La mise en page mobile de Work est cassée : le titre passe sous la topbar, « 0 % · 0/0 tâches » s'empile lettre par lettre, la rangée d'actions déborde (« + Tâche » coupé) et la grille à 2 colonnes écrase Agents et Prochaine action. La maquette montre un titre, une barre d'onglets (Overview, Tasks, Board, Timeline, Activity, Runs, …) et une seule colonne. | `mob-work-pair` |
| C2 | P2 | PC | En-tête : pas de sous-titre descriptif avec échéance ; bouton « … » en plus. Le reste de la structure (Plan, Agents, Progression, Prochaine action, Approbations, Mise à jour) correspond. [à vérifier desktop avec données] | `desk-work-pair` |

### D. Design

| # | Sév. | Viewport | Écart | Preuve |
|---|---|---|---|---|
| D1 | **P0** | PC + mobile | Style absent : les onglets (« GitHub : vérification… », Canvas, Terminal, Navigateur, Spec, Fichiers) et la barre d'outils (Select, Rectangle, Ellipse, Line, Pen, Comment, Undo, Redo, Import) sont rendus en boutons bruts à bordure blanche. Deux onglets « Canvas » coexistent. Sur mobile, les onglets débordent et le libellé GitHub passe sur deux lignes. | `desk-canvas-pair`, `mob-design-pair` |
| D2 | P1 | PC | Structure différente de la maquette : panneau « Outils design » (Structure / Design System, Pages, Calques), barre d'outils flottante (Select/Node/Pen/…/Snap), réglette Viewport, barre du bas (Présenter, Auto changes, Revert, Checkpoint, zoom). L'app affiche d'abord « Fichiers » (explorateur et aperçu). | `desk-design-pair`, `desk-canvas-pair` |
| D3 | P1 | mobile | La maquette montre le canevas avec sa barre d'outils en haut et une barre zoom/undo/Layers en bas. L'app montre la liste de fichiers. | `mob-design-pair` |

### E. Automate, Browser et Memory

| # | Sév. | Viewport | Écart | Preuve |
|---|---|---|---|---|
| E1 | GAP / [à vérifier desktop] | PC + mobile | Automate : la maquette montre le Studio (en-tête environnement/versions/publication, bibliothèque de nœuds, canevas, runbar, minimap, onglets debug). En web dev, l'app n'affiche que la page v0 en lecture seule, avec le pont en erreur, et la bibliothèque sous forme d'identifiants bruts (`trigger.manual`…). Le style de cette page de repli est lui aussi brut (entrée et puces à bordure blanche). | `desk-automate-pair`, `mob-automate-pair` |
| E2 | GAP (GAP-01) | PC + mobile | Browser : la maquette a des onglets, une page Nouvel onglet, un switch d'appareil, un contrôle IA/utilisateur et un panneau « AI Activity » (feuille du bas sur mobile). L'app a seulement une barre d'adresse et « Aller ». | `desk-browser-pair`, `mob-browser-pair` |
| E3 | [à vérifier desktop] | mobile | Memory : la maquette montre un seul volet (Note) avec Edit/Preview en en-tête. L'app empile l'erreur de pont et le volet Vault. | `mob-memory-pair` |
| E4 | P2 | PC | Bannière d'erreur du pont (Work, Automate, Memory) : texte brut et bouton « Reconnecter » pleine largeur à bordure blanche, hors du vocabulaire v110. | `desk-memory-pair` |

### F. Paramètres et Compte

| # | Sév. | Viewport | Écart | Preuve |
|---|---|---|---|---|
| F1 | P2 | PC | Polices de l'interface et du code : la maquette affiche la valeur (« System Sans », « JetBrains Mono ») dans un champ `--surface-2`. L'app montre un placeholder pâle dans un champ plus sombre. | `desk-settings-pair` |
| F2 | P2 | mobile | La liste des paramètres n'a ni titre « Paramètres » ni bouton de fermeture (×) comme dans la maquette. | `mob-settings-pair` |
| F3 | P2 | mobile | Compte, « Vos espaces » : la maquette met « Rejoindre » et « Créer » sur deux colonnes et le compteur de sessions sous le texte. L'app empile les boutons et met le compteur à droite. | `mob-user-pair` |

## Plan de correction

Chaque lot est un commit : conforme ou pas, testé et poussé. Les lots marqués [desktop] commencent par un contrôle sur l'exe desktop : sidecar reconstruit et redéployé (voir `CLAUDE.md`, Deployment). Ce contrôle dit si l'écart vient du web dev ou de l'app.

### Lot 1 — Parcours cassés (P0)
1. **A1** : à l'entrée dans une destination non-Code, si la vue est « Chat », passer en Split. Mémoriser la vue par destination, Code gardant la sienne. Mini-ADR avant (le store de vue est partagé). Test unitaire et e2e `mode-switch`.
2. **C1** : Work mobile en une colonne. En-tête sur deux lignes (titre, puis statut et actions compactes), barre d'onglets défilante comme la maquette, cartes empilées. CSS dans `v110-work*.css`.
3. **D1** : style v110 pour les onglets et la barre d'outils Design (segmented et boutons 31 px de la maquette). Supprimer le doublon « Canvas » après en avoir trouvé la cause. Onglets défilants sur mobile.

### Lot 2 — Topbar et shell (P1)
4. **A2** : la pastille serveur affiche « Auto · N », avec les données réelles du `StatusPopoverBody`.
5. **A3 / A4** : topbar de l'accueil comme la maquette, sans boutons de panneau, avec l'orbe et la pastille serveur.
6. **A5** : switch caché sur Paramètres et Compte en mobile.
7. **A6** : switch Note/Graph de Memory dans le slot central de la topbar, s'il y a une vue graph réelle ; sinon le noter en GAP.
8. **A7, A8, A10** : switch actif en aplat ; avatar à initiale ; surfaces bord à bord sur téléphone.

### Lot 3 — Éditeur (P1/P2)
9. **B1** : état « aucun fichier » avec la barre d'onglets, la barre d'outils et la barre d'état vides.
10. **B2** : barre d'état complète, avec les données déjà présentes dans les buffers, le LSP et Git (source unique, INTERACTIONS.md § Code).
11. **B3** : bouton terminal en bas à gauche ; bouton flottant sur mobile.
12. **B4, B6** : bouton « → Work » (handoff réel) et pastilles Perm/AI mobiles liées à l'état de permission réel.
13. **B5, B7** : cadrage seulement (existence d'un consommateur runtime), puis ticket GitHub ou abandon.

### Lot 4 — Design, contenu (P1)
14. **D2 / D3** : réorganiser pour ouvrir d'abord le canevas, avec le panneau Structure/Design System, la barre d'outils flottante et la barre du bas. Seules les commandes réelles (ADR-039) sont branchées ; celles sans moteur restent désactivées avec « bientôt ».

### Lot 5 — Surfaces dépendant du pont [desktop]
15. **E1, E3, E4** : sur l'exe desktop, relever l'état réel d'Automate et de Memory. Porter le Studio et le triptyque mobile là où les données existent. Restyler la bannière d'erreur du pont (carte v110, bouton secondaire).
16. **E2** : GAP-01. Porter la chrome (onglets, Nouvel onglet, AI Activity) seulement si le runtime navigateur l'alimente ; sinon ticket produit.

### Lot 6 — Finitions (P2)
17. **A9** : nom et mode des projets récents sur l'accueil.
18. **C2, F1, F2, F3** : en-tête Work ; champs de police ; titre et fermeture de la liste des paramètres mobile ; espaces du Compte sur mobile.

### Garde-fous (tous les lots)
- Avant chaque lot : vérifier que l'écart n'est pas une des différences volontaires ci-dessus.
- Pas de fonction factice : une commande sans moteur reste désactivée et étiquetée.
- Après chaque lot : typecheck, tests app, captures maquette/app aux deux tailles (`_audit.mts`), puis commit et push.
