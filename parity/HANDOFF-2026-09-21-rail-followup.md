# Handoff — parité v110 rail, suite

État vérifié à l'instant (git log/diff), pas de mémoire : tout le travail de
cette session est **commité** sur `new-ui` (rien en attente, rien à perdre).
Commits pertinents, du plus ancien au plus récent :
`f8cbc708f5`, `e7682f7126`, `6632abdd69`, `72916aebf9`.

Copier le bloc "PROMPT POUR LA PROCHAINE IA" ci-dessous tel quel dans la
nouvelle session.

---

## PROMPT POUR LA PROCHAINE IA

Tu reprends un chantier de parité visuelle pixel-perfect entre l'app Unifia
et une maquette HTML figée. Méthodologie stricte : **élément par élément**,
jamais de refonte globale. Pour chaque élément : mesurer en direct sur la
maquette (jamais faire confiance à une note déjà écrite ailleurs sans la
revérifier), comparer à l'app rendue en direct, corriger à la source unique
autoritative, mettre à jour tests/tokens, revérifier visuellement, logger
dans `parity/STATE.md`, committer, élément suivant.

### Contexte projet

- Repo : `D:\App\unifia\_a7-automate-memory`, branche `new-ui`.
- Maquette figée (référence absolue, **ne jamais la modifier**) :
  `docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html`, viewport de
  référence **1440x900**.
- Directive globale du projet (ne varie jamais) : correspondance exacte à la
  maquette, "zéro différence, mêmes fonctionnalités" — si un élément visuel
  de la maquette doit disparaître pour coller à l'app, préserver la
  fonctionnalité par un mécanisme indépendant (raccourci clavier, commande),
  jamais juste la supprimer sans équivalent.
- Journal de suivi (in-repo, pas le vault) : `parity/STATE.md`. **Attention** :
  il fait déjà 2726 lignes, largement au-dessus du seuil de refactor
  obligatoire du projet (1500 lignes). Ne pas le refactorer toi-même sauf si
  explicitement demandé — continuer à y ajouter des sections datées comme les
  précédentes, le nettoyage est hors scope tant que non demandé.

### Pipeline de vérification live (CDP/Playwright)

1. Backend : `bun run --cwd packages/unifia --conditions=browser src/index.ts serve --port 4099 --hostname 127.0.0.1`
2. Vite : `VITE_OPENCODE_SERVER_HOST=127.0.0.1 VITE_OPENCODE_SERVER_PORT=4099 npx vite --port 4447 --strictPort` (depuis `packages/app`)
3. Brave headless avec CDP : `brave.exe --headless=new --remote-debugging-port=9333 --remote-debugging-address=127.0.0.1 --user-data-dir=<profil scratch> --no-first-run --no-default-browser-check --disable-gpu`
4. Route de session à charger dans le navigateur piloté :
   `http://127.0.0.1:4447/RDpcQXBwXHVuaWZpYVx1bmlmaWE/session`
   (c'est le base64url du chemin projet `D:\App\unifia\unifia`)
5. Se connecter via Playwright `connectOverCDP` sur `http://127.0.0.1:9333`.
6. Script jetable dans `packages/app/scripts/parity/_nom.ts` (préfixe `_`,
   **toujours supprimé après usage**, jamais commité) pour mesurer des
   `getBoundingClientRect()`/`getComputedStyle()` sur la maquette ET sur
   l'app, aux mêmes coordonnées CSS, au même viewport 1440x900.

**Piège connu et non résolu à date** : le host peut entrer en crise mémoire
(vu descendre à 1,5 Go libre sur 15,71 Go via
`[Microsoft.VisualBasic.Devices.ComputerInfo]::new().AvailablePhysicalMemory`)
à cause de process **qui ne sont pas les tiens** (Zoom, d'autres sessions
Claude Code, Windows Defender). Symptôme : le WebSocket CDP se connecte mais
le handshake protocolaire Playwright n'aboutit jamais (timeout 30s). **Règle
anti-boucle du projet** : après ~3-4 tentatives identiques qui échouent,
arrête-toi, vérifie via `Get-Process | Sort-Object WorkingSet64 -Descending`
que c'est bien un problème externe (pas ton propre navigateur — le mien
tournait avec seulement 2 onglets), et rapporte honnêtement le blocage à
l'utilisateur plutôt que de prétendre une vérification qui n'a pas eu lieu.
Ne tue aucun process qui n'est pas clairement le tien (jamais Defender,
jamais un process `claude`/`Zoom` d'un autre usage).

### Ce qui a déjà été corrigé (ne pas refaire)

Rail de navigation gauche (`packages/app/src/pages/layout/sidebar-shell.tsx`,
`packages/app/src/context/mode.tsx`, `packages/ui/src/components/icon.tsx`,
`packages/app/src/styles/v110.css`) :

1. **Largeur du rail** : token `--v110-rail` corrigé de 78px → 62px (mesuré
   en direct sur la maquette à 1440x900 ; les boutons internes 42px étaient
   déjà bons, seul le conteneur était faux). 5 littéraux de fallback
   `var(--v110-rail, 78px)` mis à jour en écho dans `layout.tsx` et
   `sidebar-shell.tsx`.
2. **Icônes des 4 modes** : remplacé les icônes génériques (`code`/`folder`/
   `edit`/`checklist`, utilisées ailleurs dans l'app pour autre chose) par les
   vrais tracés SVG de la maquette pour Code/Work/Design/Automate — nouvelles
   icônes `brackets`/`briefcase`/`flower`/`workflow` dans `icon.tsx`, ajoutées
   à `ICONS_24_VIEWBOX` (espace de coordonnées natif 24x24 de la maquette, pas
   le 20x20 par défaut de l'app). Pas de `fill`, uniquement `stroke` (le CSS
   par défaut de la maquette est `fill:none` — piège déjà rencontré : ne pas
   copier le pattern `fill="currentColor"` de l'icône `browser`/`brain`).
3. **Pills Browser/Memory** : ajoutées comme raccourcis de destination (pas
   des `SHELL_MODES` — `SHELL_MODES` reste figé à exactement
   `["code","work","design","automate"]`, contrat vérifié par
   `scripts/check-mode-registry.mjs`). `PILL_TARGET` route browser→design,
   memory→code.
4. **Esthétique du bouton actif** : une note antérieure dans `STATE.md`
   affirmait un fond sombre `#2c2c2f` "mesuré en direct" — **faux**, re-mesuré
   cette session au viewport 1440x900 : fond clair `rgb(222,222,224)`, texte
   `rgb(23,23,26)`, plus une barre d'accent verticale 3px accolée à gauche du
   bouton. Corrigé avec les tokens sémantiques existants
   `--surface-raised-base-active` et `--text-strong` (correspondance quasi
   exacte), pas de nouveau littéral. **Leçon** : une mesure "live" écrite
   ailleurs doit être revérifiée, jamais simplement citée, si le résultat
   visuel ne correspond pas à l'attendu.
5. **Bouton de projet supprimé** (sur instruction explicite utilisateur,
   contredisant une recommandation antérieure de le garder) : nettoyage en
   cascade complet, pas juste un masquage — `sidebar-project.tsx` (383
   lignes) supprimé entièrement, `createProjectSidebarContext`/
   `ProjectSidebarDeps` retirés de `layout-contexts.ts`, handlers de drag et
   champ persisté `activeProject` retirés de `layout.tsx`, imports
   `@thisbeyond/solid-dnd` nettoyés. Vérifié avec `bunx biome check`
   (le typecheck seul ne détecte pas les imports/variables mortes sur ce
   projet — toujours faire les deux).
6. **Positionnement du groupe du bas** : le bouton "+"/Ouvrir un projet
   déplacé du cluster du haut vers juste au-dessus du bouton compte, en bas.
   Padding bas corrigé de `pb-6` (24px) à `pb-2` (8px) après re-mesure
   précise du vrai gap de la maquette (9px, `.rail{padding:8px 6px}`).
7. **Visibilité d'Automate** : `visibleModes` dans `context/mode.tsx` ne
   filtre plus par capacité — retourne toujours `SHELL_MODES` complet.
   **Décision utilisateur explicite** après avoir signalé que ce filtrage
   était un vrai contrôle de sécurité documenté (ADR-1041, capacité serveur
   `workflow.run`), pas un bug de rendu. Portée du fix **volontairement
   étroite** : `isMode()` (validation de route) et tout le mécanisme
   `automateAccess`/`AutomateGrantBridge` (refus serveur réel si la capacité
   manque) restent **intacts** — seule la visibilité de l'icône a changé.

### Ce qui reste ouvert

1. **Vérification visuelle live jamais aboutie** pour les points 2 à 7
   ci-dessus (bloquée par la crise mémoire hôte à chaque tentative). Priorité
   n°1 en reprenant : refaire une capture côte-à-côte maquette vs app au
   rail (1440x900) dès que le host est disponible. Statut actuel de preuve :
   `bun run typecheck` et `bun test` (1636/1636) verts, mais pas de
   confirmation pixel.
2. **Octroi réel de la capacité `workflow.run`** (option 2 choisie par
   l'utilisateur, non implémentée) : `SURFACE_LEASE_CAPABILITIES`
   (`packages/workbench-shell/src/routes.ts:185`) ne demande pas
   `workflow.run` du tout — l'y ajouter rendrait Automate potentiellement
   utilisable par défaut pour **toutes** les connexions, pas seulement ce
   projet de test. **Ne pas trancher seul** : reposer explicitement la
   question de la portée voulue (test-only vs. global) avant de toucher à ce
   fichier — c'est un changement de sécurité, pas cosmétique.
3. **Faux positif pré-existant** de `scripts/check-mode-registry.mjs` sur
   `MODE_PILLS` de `home.tsx` (confirmé via `git stash` comme antérieur à
   cette session, pas causé par le travail ci-dessus). Déjà signalé comme
   tâche de fond `task_7fc2d3f6` — ne pas le refaire, juste vérifier s'il a
   été traité entre-temps avant d'agir dessus.
4. `parity/STATE.md` à 2726 lignes, largement au-dessus du seuil de refactor
   du projet — signalé plusieurs fois, jamais traité, explicitement hors
   scope pour un fix ponctuel. Ne pas le refactorer sans demande explicite.

### Prochain élément suggéré

Après la vérification visuelle du rail, continuer la méthodologie élément
par élément sur la zone suivante non encore auditée de la maquette (topbar
déjà largement traitée dans une session précédente — voir
`Session-Recap-v110-Topbar-Precision-And-CtrlP-Race-2026-09-21` dans le vault
Obsidian `IA_Dev_Brain/projects/unifia/sessions/` si accessible). Si aucune
zone évidente ne reste, redemander à l'utilisateur quel panneau/élément de la
maquette auditer ensuite plutôt que de deviner.

### Discipline à respecter

- Scripts de diagnostic jetables : préfixe `_`, dans
  `packages/app/scripts/parity/`, toujours supprimés après usage, jamais
  commités.
- `bun turbo typecheck` doit être lancé avec `--concurrency=1` sur cette
  machine (sinon OOM tsgo avec une erreur trompeuse).
- Commits en anglais, format `fix(parity): <description>`, un commit par
  élément corrigé, message expliquant le "pourquoi" et la portée exacte
  (affects/does not affect) — voir les 4 commits de cette session comme
  modèle de style.
- Ne jamais modifier la maquette HTML de référence.
- Face à un conflit entre "ce que dit l'utilisateur" et "ce qu'une session
  précédente a documenté/recommandé" : suivre l'instruction directe de
  l'utilisateur, ne pas défendre l'analyse antérieure.
- Face à un filtrage/masquage qui s'avère être un contrôle de sécurité ou
  d'architecture documenté (ADR, capacité serveur) : le signaler
  explicitement et demander confirmation avant de le lever, jamais le
  contourner en silence.
