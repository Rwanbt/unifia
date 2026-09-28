<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Audit de parité : panneau Editor de Design et d'Automate (BROUILLON)

**Date** : 2026-09-28 · **Branche** : `new-ui` @ `6836176a4c`
**Référence** : `Unifia-UI-UX-v110-JARVIS-TOPBAR-PROTOTYPE-V5.html`
**Statut** : audit incomplet. Le relevé est fait ; le plan d'exécution autonome n'est pas encore écrit.

## Méthode

- **Captures** maquette | app, vue Editor et vue Split, à 1440×900 et 390×844. Sonde `packages/app/tmp/parity/_dsau.mts` ; sorties dans `C:/tmp/audit/ds/*.png`, avec un arbre DOM mesuré par état dans `*.txt`.
- **CSS de référence** : les règles de la maquette qui s'appliquent à chaque surface, dans l'ordre de la cascade et avec leurs `@media`. Sonde `_maqrules.mts` ; sorties dans `C:/tmp/audit/ds/rules-<mode>-<desk|mob>.css` (Automate 265 règles, Design 528). Ce corpus empile les couches de patchs de la maquette. Pour le port, repartir des valeurs calculées des `*.txt`.
- En web dev, le pont Workbench est connecté (« Connecté à l'instance Workbench … »).

## Automate — constats

| # | Sév. | Écart |
|---|---|---|
| AU1 | **P0** | L'app affiche la page « v0 » en document : titre, Node library en puces brutes, liste des définitions, « Recent runs ». La maquette affiche d'emblée le Studio `a60` plein cadre (voir la structure ci-dessous). |
| AU2 | **P0** | Les composants du Studio existent déjà mais ne s'affichent qu'après « Inspecter » une définition, dans une grille à cartes (`automate-surface.tsx:321`) : `automate-studio-canvas`, `-library`, `-inspector`, `-run-bar`, `-environment`, `-step-list`. **`automate-studio-minimap.tsx` n'est jamais monté.** |
| AU3 | P1 | Sans workflow, il faut un état vide dans le Studio lui-même, avec une action réelle « Nouveau workflow » (`createFiles` dans `.unifia/workflows/`). |
| AU4 | P1 | La bibliothèque doit rester celle du runtime (`NodeFamilySchema` : trigger.manual/schedule, control.*, tool.http/transform, human.approval, wait) : **différence volontaire**. En revanche, le rendu doit suivre la grille 2 colonnes de la maquette (cartes 105×52, radius 10, titre 9px, sous-titre 8px) et non des puces. |
| AU5 | P1 | Mobile : en-tête (nom, env, •••, Publish), runbar flottante, canevas plein écran, barre du bas (− % + Fit Debug Nodes). L'app empile la page document. |

**Structure maquette, PC** (mesures des `*.txt`) :
- **En-tête `a60-head`, 44 px** : pastille dirty, nom 11px, « Draft 1 · unpublished » 9px, select Environnement 94×30 (radius 9), « Draft saved locally ». À droite : Undo, Redo, Versions, Import, Export, Publish (boutons 30 px de haut, radius 9, fond `rgb(27,27,30)` ; Publish en fond `#f2f2f3`).
- **Colonne gauche `a60-lib`, 232 px** : tête « Nodes » avec bouton de repli 28×28, recherche 32 px (radius 10), catégories en capitales 8px, grille de nœuds.
- **Canevas** :
  - runbar flottante en haut à gauche : Validate, Test, Run (primaire), Stop, select de fixture, point d'état, → Work ;
  - minimap en haut à droite, environ 140×80 ;
  - zoom en bas à droite : − % + Fit.
- **Panneau debug en bas** : onglets Runs, Data, Logs, Tests, Problems ; repliable.

**Correspondance runtime** (sans fonction factice) :

| Élément maquette | Côté app |
|---|---|
| Publish | `publishDraft` |
| Run | `startWorkflow` |
| Stop | `cancelApproval` / `updateWorkflow(cancel)` |
| Validate | `validateDefinition` + `augmentValidateReport` |
| Problems | lignes de `validateReport` |
| Runs | `listWorkflows` |
| Export | téléchargement JSON du brouillon |
| Import | `createFiles` |
| Versions | fichiers publiés par `publishedDraftPath` |
| Undo/Redo | historique local de positions, arêtes et nœuds ajoutés |
| Test, fixture, Environnement | pas de moteur : à désactiver et étiqueter « bientôt », ou à brancher sur `AutomateStudioEnvironment` (grants/approbations) |
| Data, Logs, Tests | **à cadrer** : existe-t-il une source runtime ? |

## Design — constats

| # | Sév. | Écart |
|---|---|---|
| DE1 | **P0** | L'app ouvre sur « Fichiers » : une barre d'onglets GitHub/Canvas/Terminal/Navigateur/Spec/Fichiers en boutons bruts à bordure, un explorateur et « Sélectionne un fichier pour l'aperçu ». La maquette ouvre sur le canevas outillé. |
| DE2 | P1 | Panneau gauche « Outils design », 240 px :<br>– en-tête et « → Work » ;<br>– 3 rangées d'icônes : Rafraîchir, Aperçu/Source, Format d'appareil ; Capture→chat, Inspecter, Commenter, Annoter, Modifier, Vector ; Historique, Commentaires (compteur), Exporter, Partager, Audit ;<br>– segmented Structure / Design System ;<br>– « Créer un élément » ;<br>– Pages avec « ••• » et « + Nouvelle page » ;<br>– Calques avec recherche, arbre et actions renommer/œil/verrou ;<br>– Assets.<br>Absent de l'app. |
| DE3 | P1 | Dock haut du canevas :<br>– barre d'outils 829×41 : Select, Node, Pen, Crayon, Ligne, Rect, Ellipse, Snap ;<br>– réglette « Viewport » : slider et champ px ;<br>– pastille « AI Local Preview · Auto ».<br>L'app a une barre d'outils Canvas distincte (`design-toolbar.tsx`, ADR-039). |
| DE4 | P1 | Bas du canevas :<br>– « Présenter » à gauche ;<br>– changebar au centre : ✓ Saved, ↶, ↷, Revert, Checkpoint ;<br>– zoom − 100% + à droite (130×40, radius 14).<br>Panneau Commentaires à droite, repliable. |
| DE5 | P1 | Mobile : canevas plein écran, barre d'outils en haut (boutons 36×36), champ largeur 1000, barre du bas (zoom, undo, redo, revert, checkpoint, « ☰ Layers » qui ouvre le panneau en feuille). |

**À cadrer avant le plan** : quelles commandes de DE2–DE4 ont un moteur réel.
- **Candidats réels** :
  - `DesignArtifactTab` : viewport, zoom, snapshot, commentaires, select ;
  - spec, versions, export (`runExportFlow`), `openSpecInWorkshop` ;
  - `DesignCanvasTab`.
- **Probablement sans moteur** : pages, calques, assets, Design System, crayon, Vector, Audit. Les montrer désactivées avec « bientôt », ou les retirer.
- **Où ranger** Terminal, Navigateur, Fichiers et Spec (menu « … » ?) : décision produit à prendre.

## Autres constats

- `src/index.css` importe `v110-live-orb.css` deux fois (lignes 16 et 20).

## Reste à faire (prochaine session)

1. **Cadrage** : lire `design-canvas-tab.tsx`, `design-toolbar*.tsx`, `design-artifact-tab.tsx` et `automate-studio-*.tsx` pour classer chaque contrôle en réel ou sans moteur.
2. **Mini-ADR** : la surface Design ouvre sur le canevas et relègue les onglets ; le Studio Automate devient la surface par défaut.
3. **Plan** : écrire `PLAN-EXECUTION-DESIGN-AUTOMATE.md` au format de `PLAN-EXECUTION-PARITE-V5.md`. Tâches atomiques avec ancres exactes, CSS porté dans `v110-automate.css` et `v110-design.css`, sondes `probe.mts`, un commit par tâche.
