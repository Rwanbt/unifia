# RESPONSIVE-MATRIX — contrats v110 (ne pas reinventer)

## Breakpoints canoniques (manifest)

- desktop-wide: width >= 1200 — side panels grid-reserved, layouts chat/split/main.
- desktop-compact: 900-1199 — single-side-utility, context et inspector mutuellement exclusifs.
- tablet-portrait: 600-839 portrait — overlays, layouts chat/main.
- phone-portrait: width <= 599 portrait — overlays, single pane + bottom nav.
- compact-landscape: height <= 560 et width <= 980 landscape — overlays, chat/split/main.

## Viewports de certification (e2eContract)

- 1920x1080, 1440x900, 1280x800, 1024x768 (desktop).
- 768x1024 (tablet portrait), 1024x768 (tablet landscape).
- 390x844, 360x800 (mobile portrait), 844x390 (mobile landscape).
- Tester aussi les seuils immediatement autour des breakpoints.

## Invariants par viewport

- desktop-wide: context peut coexister avec inspector; workspace non-overlapped.
- desktop-compact: ouvrir context ferme inspector et inversement.
- tablet-portrait: context et inspector en overlay.
- phone-portrait: overlay exclut l interaction workspace tant qu ouvert.
- compact-landscape: overlay commence apres le rail compact; split reste disponible.

## Regles globales

- Aucun overflow global involontaire (audit v98: root-overflow > 6px = fail).
- Aucun panneau recouvrant le workspace sans comportement overlay prevu.
- Aucun controle coupe, aucun z-index incorrect, aucun element inaccessible.
- Touch targets: carres 31px desktop, 38-44px touch (contrat square, pas de rectangles 31x44).
- Scroll correct, safe-area correcte, layout switching correct.
- Conteneurs reels: workspace-body et surfaces sont des containers (container queries); les composants reagissent a l espace recu, pas au nom du device.
- Deduplication: une seule source de verite responsive (pas de second store local concurrent).

## Layouts par mode (matrice minimale)

Pour chaque mode pertinent (code/work/design/automate + memory note/graph + settings/user):

- Chat / Split / Main (Graph seulement Memory, independant du layout global).
- panneau gauche ouvert/ferme, inspector ouvert/ferme (avec invariant desktop-compact).
- Explorer, Trajectory/Observability (onglet Execution de l inspector natif).
- desktop + tablet + mobile portrait + mobile landscape.

## Contrats par vue (verifies e2e, phase 12)

Les cinq familles certifiees sont desktop-wide-1440x900, desktop-compact-1024x768,
tablet-portrait-768x1024, phone-portrait-390x844, compact-landscape-844x390.

- **12.1 — panneau Memory** (`e2e/v110/a3-responsive.spec.ts`) : triptyque 3 panes
  visibles sur les familles desktop, 1 seule pane sur les familles overlay
  (`tablet-portrait`, `phone-portrait`, `compact-landscape`), zero x-overflow
  global a chaque etape.
- **12.2 — dialogue Settings** (`e2e/v110/settings-responsive.spec.ts`) : listes
  verticales d onglets (`role=tab`, General selectionne) sur les familles
  desktop, et drill-down mobile (`[data-slot="settings-mobile-nav"]` :
  liste -> detail -> retour) sur les familles overlay ; la liste d onglets
  desktop ne monte jamais en overlay et inversement ; zero x-overflow.
- **12.3 — surface Code** (`e2e/v110/a4-responsive.spec.ts`) : sur les 5
  familles, le workspace Code est monte et visible, le toggle terminal reste
  atteignable et rapporte l etat ferme (`aria-expanded=false`,
  `#terminal-panel[aria-hidden=true]`) — contrat handset « terminal cache par
  defaut » — zero x-overflow, zero erreur console. L ouverture du terminal
  (PTY ghostty-web, latence CI connue #71) reste couverte par la suite
  terminal, pas par ce gate.
- **12.4 — split Design** (`e2e/v110/a6-responsive.spec.ts`) : le split suit
  la classification v110 — `desktop` (split + handle) sur desktop-wide,
  `tablet` sur desktop-compact et compact-landscape, `mobile` (une surface +
  switcher assistant/atelier) sur tablet-portrait et phone-portrait ; le
  switcher n existe que sur les familles mobiles, zero x-overflow et zero
  erreur console. Complete V14 (overflow 375/768/1280/1440 + switcher 375) en
  couvrant compact-landscape et les kinds tablet/desktop certifies.
- **12.5 — surface Work** (`e2e/v110/work-responsive.spec.ts`) : avec le bridge
  workbench mocke (`fixtures/workbench-mock`, deja utilise par Memory/Design),
  la surface Work monte sur les 5 familles, ses 6 onglets de vues restent
  atteignables et commutent le contenu (board puis overview), zero x-overflow
  et zero erreur console. Le contenu Team est desormais prouve en web par
  `e2e/v110/work-team-panels.spec.ts` (mock installe, plus de skip bridge) :
  etats vides honnetes des 6 panneaux + grille d operations intacte.
- **12.6 — studio Automate** (`e2e/v110/automate-responsive.spec.ts`) : le mock
  sert une definition reelle (`fileContents` -> `readFiles`, + `listWorkflows`)
  et le studio monte sur les 5 familles. Le canvas SVG est remplace par la
  step list exactement sur les overlay (`tablet-portrait`, `phone-portrait`,
  `compact-landscape`) et la librairie se replie dans l accordion ; le run bar
  et l inspecteur restent atteignables sur toutes les familles, la selection
  d un noeud quitte l etat vide de l inspecteur, zero x-overflow et zero
  erreur console.
- **Inspector Explorer/Inspector/Execution** (`a3-responsive.spec.ts`) : les
  3 onglets restent atteignables et selectionnables sur les 5 familles, y
  compris compact-landscape depuis le fix #91 (drawer fermee invisible).

## Handset specifics (valide v99-v110)

- Code: terminal cache par defaut a la premiere entree compacte; codebar 38px homogene.
- Work: header 40px, tabs 38px, toolbar nowrap, More fixe en haut (pas dans les tabs).
- Design: bottom-bar unifiee (zoom + changebar + layers), layers = bottom-sheet resizable 190-620px.
- Automate: runbar une ligne scrollable, run/stop 30-34px icones, tools bottom-centre, nodes = bottom-sheet.
- Memory: toolbar 42px une ligne, persistence masquee en compact, editor = hauteur restante exacte.
