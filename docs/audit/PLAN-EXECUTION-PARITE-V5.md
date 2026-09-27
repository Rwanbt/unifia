<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# Plan d'exécution autonome — parité UI V5 (mode goal)

Ce plan corrige les écarts retenus de `docs/audit/AUDIT-UI-PARITE-V5-2026-09-28.md`.
Il est écrit pour une IA exécutante en autonomie. Les ancres de texte ont été vérifiées uniques et les tâches T1, T2, T3, T5, T7 et T8 ont été appliquées à blanc (typecheck propre, comportement contrôlé) le 2026-09-28, sur `new-ui` @ `71ebe26e49`. Chaque tâche indique les
fichiers exacts, le code à écrire, la vérification et le message de commit.
**Exécute les tâches dans l'ordre, une par une, sans en sauter ni en fusionner.**

---

## 0. Règles absolues (à relire avant chaque tâche)

1. **Dossier de travail** : `D:\App\unifia\_a7-automate-memory` (worktree git), branche `new-ui`. Ne change pas de branche. Ne fais jamais de `git push --force`, `git reset --hard`, `git stash` ou `git rebase`.
2. **Icônes et animations interdites** : ne modifie, ne remplace et ne supprime aucune icône existante (`<Icon name=…>`, SVG, glyphes). Ne touche à aucune animation, `@keyframes`, `transition` ou `animation`. Tu peux réutiliser une icône existante sur un nouveau bouton (tâche T7), avec exactement le même `name`.
3. **Pas de fonction factice** : n'ajoute aucune donnée inventée et aucun bouton sans action réelle.
4. **Modifications de code** : utilise l'outil d'édition par remplacement de texte exact (ancre littérale). Jamais `sed`, `awk` ni regex sur le code source.
5. **Nouveau fichier** : il commence par l'en-tête SPDX, sinon le hook pre-commit le refuse.
   - `.css`, `.ts`, `.tsx` : `/* SPDX-License-Identifier: MIT */`
   - `.md` : `<!-- SPDX-License-Identifier: MIT -->` puis `<!-- Copyright (c) 2026 Unifia contributors -->`
6. **i18n** : ce plan n'ajoute aucune clé de traduction ; il réutilise des clés existantes. Si tu crées quand même une clé, ajoute-la dans **tous** les fichiers `packages/app/src/i18n/*.ts` (texte anglais hors `fr.ts`), sinon `src/i18n/parity.test.ts` échoue.
7. **Écarts à ne jamais corriger** (volontaires) :
   - la pastille serveur reste une icône ;
   - le switch Chat/Editor reste affiché dans Paramètres et Compte sur mobile ;
   - la barre d'état de l'éditeur n'a ni synchro, ni LSP, ni encodage, ni fin de ligne, ni Ln/Col (pas de source de données, commenté dans `session-editor-surface.tsx`) ;
   - les décisions #98, ADR-039, ADR-053 et ADR-058 ;
   - les pastilles du compositeur ;
   - l'orbe Live limité à ON/OFF ;
   - pas de « Verrouiller Unifia ».
8. **Anti-boucle** : après 3 tentatives ratées sur une même tâche, arrête cette tâche. Annule ses modifications non commitées avec `git checkout -- <fichiers de la tâche>`. Écris `BLOCKED Tn : <diagnostic en 3 lignes>` à la fin de `docs/audit/EXECUTION-LOG.md`, commite ce fichier seul et passe à la tâche suivante.
9. **Portée** : ne modifie que les fichiers listés par la tâche, plus `docs/audit/EXECUTION-LOG.md`.

---

## 1. Préparation (une seule fois)

Depuis `D:\App\unifia\_a7-automate-memory` :

```bash
git status -sb
```
Attendu : `## new-ui...origin/new-ui`. Un seul fichier non suivi est toléré : `.build-temp/`. Sinon, arrête-toi et signale-le.

Les serveurs de dev doivent répondre. Vérifie :

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4448/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4099/
```
Attendu : `200` puis `401` (le backend exige une authentification ; 401 est normal).

S'ils ne répondent pas, lance-les dans deux terminaux en arrière-plan :

```bash
cd packages/unifia && tail -f /dev/null | UNIFIA_SERVER_PASSWORD=$(cat $TEMP/unifia-dev-pw.txt) bun run --conditions=browser src/index.ts serve --port 4099
cd packages/app && VITE_OPENCODE_SERVER_PORT=4099 bun run dev -- --port 4448
```

Capture de référence avant tout changement :

```bash
node --experimental-strip-types docs/audit/tools/capture.mts
python docs/audit/tools/pair.py
```
Attendu : des fichiers `C:/tmp/audit/*-pair.png` (maquette à gauche, app à droite).

Crée `docs/audit/EXECUTION-LOG.md` avec l'en-tête SPDX Markdown et une ligne `# Journal d'exécution`, puis commite-le seul :

```bash
git add docs/audit/EXECUTION-LOG.md && git commit -m "docs(audit): start the parity plan execution log"
```

### Boucle de fin de chaque tâche (T1…T11)

1. Typecheck, depuis `packages/app` : `bun run typecheck`. Attendu : aucune ligne `error`.
2. Tests, depuis `packages/app` : `bun test --preload ./happydom.ts ./src`. Attendu : `0 fail`.
   - Si un test lit le code source et attend l'ancienne valeur, mets à jour **ce test seulement**, avec un commentaire d'une ligne expliquant le nouveau contrat.
3. Vérification propre à la tâche (section « Vérifier »).
4. Commit, depuis la racine : `git add <fichiers listés>` (jamais `git add -A`), puis `git commit -m "<message donné>"`.
5. Push : `git push origin new-ui`.
6. Ajoute `Tn OK <hash court>` dans `docs/audit/EXECUTION-LOG.md`, puis `git add docs/audit/EXECUTION-LOG.md && git commit -m "docs(audit): log Tn" && git push origin new-ui`.

**Outil de vérification** (depuis la racine) :

```bash
node --experimental-strip-types docs/audit/tools/probe.mts <desk|mob> "<clics séparés par ;;>" "<sélecteurs à mesurer séparés par ;;>" <sortie.png> [home]
```
Il affiche la boîte `[x, y, largeur, hauteur]` et quelques styles de chaque élément mesuré, puis `scrollWidth`. Si `scrollWidth` dépasse la largeur de l'écran (1440 ou 390), la page déborde horizontalement.

---

## T1 — Ouvrir chaque mode avec sa surface visible (P0, A1)

**Problème.** Depuis la vue « Chat », ouvrir Work, Design ou Automate n'affiche que le chat. Un effet existant passe déjà en Split pour Paramètres, Compte, Browser et Memory, mais pas pour ces trois modes.

**Fichier** : `packages/app/src/pages/session.tsx`

**Remplacer exactement** :
```ts
const MAIN_PANE_DESTINATIONS: ReadonlySet<string> = new Set(["settings", "user", "browser", "memory"])
```
**par** :
```ts
// Every destination with its own surface opens beside the chat, like the
// reference; only Code keeps the layout the user picked.
const MAIN_PANE_DESTINATIONS: ReadonlySet<string> = new Set([
  "settings",
  "user",
  "browser",
  "memory",
  "work",
  "design",
  "automate",
])
```
Ne touche pas à l'effet qui utilise cette constante (juste en dessous, avec `on(() => mode.destination(), …)`).

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts mob "[data-v110=\"mobile-nav\"] [data-destination=\"work\"]" "[data-v110=\"work-view\"]" C:/tmp/audit/t1-mob.png
node --experimental-strip-types docs/audit/tools/probe.mts desk "[data-v110=\"rail-mode\"][data-mode=\"design\"]" "[data-workbench-surface=\"design\"]" C:/tmp/audit/t1-desk.png
```
Attendu : chaque sélecteur mesuré renvoie **au moins un** élément (tableau non vide) de largeur supérieure à 0. Avant la correction, la commande mobile renvoie `[]`.

**Commit** : `fix(ui): Work, Design and Automate open beside the chat instead of staying hidden`
**Fichiers** : `packages/app/src/pages/session.tsx`

---

## T2 — Work sur téléphone : en-tête, onglets, une colonne (P0, C1)

**Problème.** À 390 px, l'en-tête de Work déborde, la grille à deux colonnes écrase les cartes, et il n'y a pas d'onglets de vue. La maquette a un titre, une barre d'onglets défilante et une seule colonne.

**Différence volontaire à conserver** : la maquette cache les actions (Plan IA, Annuler, + Tâche) sur téléphone. On les **garde**, sur une ligne défilante sous le titre, pour ne perdre aucune fonction.

### T2.a — Onglets de vue dans la surface

**Fichier** : `packages/app/src/pages/workbench/work-surface.tsx`

1. Remplacer la ligne d'import :
```ts
import { Show, createEffect, createMemo, onMount, type JSX } from "solid-js"
```
par :
```ts
import { For, Show, createEffect, createMemo, onMount, type JSX } from "solid-js"
```
2. Juste après cet import, ajouter :
```ts
import { WORK_VIEW_LABEL_KEY, WORK_VIEWS } from "@/context/work-view"
```
Si `@/context/work-view` est déjà importé dans ce fichier, ajoute seulement les deux noms manquants à l'import existant.

3. Dans `WorkSurface()`, repérer ce bloc (fin de l'appel `<WorkCockpitHeader …/>`) :
```tsx
            menu={<WorkArtifactMenu artifacts={artifacts} />}
          />
          <div data-v110="work-content" data-parity="work.content" data-work-view-content={view()}>
```
et le remplacer par :
```tsx
            menu={<WorkArtifactMenu artifacts={artifacts} />}
          />
          {/* Phones: the reference picks the view from a strip of tabs in the
              surface (.work65-mobile-tabs); wider layouts pick it from the
              context panel, so the strip is hidden there (v110-work.css). */}
          <nav data-v110="work-mobile-tabs" aria-label={t("sidebar.work.views")}>
            <For each={WORK_VIEWS}>
              {(item) => (
                <button
                  type="button"
                  data-v110="work-btn"
                  data-primary={view() === item ? "" : undefined}
                  aria-pressed={view() === item}
                  onClick={() => layout.work.setView(item)}
                >
                  {t(WORK_VIEW_LABEL_KEY[item])}
                </button>
              )}
            </For>
          </nav>
          <div data-v110="work-content" data-parity="work.content" data-work-view-content={view()}>
```
Cette forme passe le typecheck (vérifié à blanc le 2026-09-28). Si une version plus récente du code la refuse, écris `t(WORK_VIEW_LABEL_KEY[item] as never)`, la forme déjà utilisée dans `pages/workbench/work-cockpit.tsx`.

### T2.b — CSS téléphone

**Fichier** : `packages/app/src/styles/v110-work.css`. Ajouter **à la fin du fichier** :
```css
/* Phones -- V5 at 390px (.work65-mobile-tabs, measured): a 40px strip of
 * 32px tabs, 3px apart, 4px/6px padding, scrolling sideways without a bar;
 * the active tab is the primary (inverted) button. The header wraps: title
 * on its own line, then the health pill and the actions (kept on phones,
 * unlike the reference, so no action is lost). One column of cards. */
[data-v110="work-mobile-tabs"] {
  display: none;
}

@media (max-width: 599px), (max-width: 700px) and (orientation: portrait) {
  [data-v110="work-top"] {
    flex-wrap: wrap;
    height: auto;
    gap: 8px;
  }

  [data-v110="work-title"] {
    flex: 1 1 100%;
  }

  [data-v110="work-title"] h2 {
    font-size: 12px;
  }

  [data-v110="work-actions"] {
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  [data-v110="work-actions"] > * {
    flex: 0 0 auto;
  }

  [data-v110="work-mobile-tabs"] {
    display: flex;
    flex-shrink: 0;
    gap: 3px;
    padding: 4px 6px;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--v110-card-line);
    background: var(--v110-card-bg);
  }

  [data-v110="work-mobile-tabs"] [data-v110="work-btn"] {
    flex: 0 0 auto;
  }

  [data-v110="work-grid"] {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

**Vérifier** (T1 doit déjà être fait) :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts mob "[data-v110=\"mobile-nav\"] [data-destination=\"work\"]" "[data-v110=\"work-mobile-tabs\"] button;;[data-v110=\"work-grid\"];;[data-v110=\"work-top\"]" C:/tmp/audit/t2-mob.png
node --experimental-strip-types docs/audit/tools/probe.mts desk "[data-v110=\"rail-mode\"][data-mode=\"work\"]" "[data-v110=\"work-mobile-tabs\"]" C:/tmp/audit/t2-desk.png
```
Attendu sur mobile :
- 6 onglets de hauteur 32, le premier « actif » ;
- `work-grid` d'une largeur inférieure ou égale à 370 ;
- `scrollWidth` égal à 390.

Attendu sur PC : `work-mobile-tabs` affiché en `display: none`.

Ouvre `C:/tmp/audit/t2-mob.png` : le titre ne doit pas être caché sous la topbar et aucun texte ne doit s'empiler lettre par lettre.

**Commit** : `fix(ui): Work reads on phones, with the reference's view tabs and one column`
**Fichiers** : `packages/app/src/pages/workbench/work-surface.tsx`, `packages/app/src/styles/v110-work.css`

---

## T3 — Style v110 des barres de Design (P0, D1)

**Problème.** Les onglets et boutons de Design (GitHub, Canvas, Terminal, Navigateur, Spec, Fichiers, et Select, Rectangle, … Import) sont rendus en boutons bruts à bordure blanche. La classe Tailwind `border-border-base` y vaut 19,5 % de blanc.

**Principe** : ne pas toucher aux classes existantes. Ajouter une feuille v110 qui cible les attributs `data-*` déjà présents. Les feuilles v110 ne sont pas dans une couche CSS, donc elles priment sur les utilitaires Tailwind.

### T3.a — Attributs manquants

**Fichier** : `packages/app/src/pages/workbench/design-canvas-tab.tsx`

1. Remplacer exactement :
```tsx
      <div class="flex items-center gap-2 border-b border-border-base px-2 py-1">
        <For each={designTools}>
```
par :
```tsx
      <div data-v110="design-canvas-toolbar" class="flex items-center gap-2 border-b border-border-base px-2 py-1">
        <For each={designTools}>
```
Avant d'éditer, vérifie que l'ancre est unique :
```bash
grep -c "border-b border-border-base px-2 py-1\">" packages/app/src/pages/workbench/design-canvas-tab.tsx
```
Attendu : `1`. S'il y en a plusieurs, prends celle qui est immédiatement suivie de `<For each={designTools}>`.

2. Dans le même fichier, sur le bouton d'outil, remplacer exactement :
```tsx
              data-design-tool={entry}
```
par :
```tsx
              data-design-tool={entry}
              aria-pressed={tool() === entry}
```

### T3.b — Nouvelle feuille

**Créer** `packages/app/src/styles/v110-surface-controls.css` :
```css
/* SPDX-License-Identifier: MIT */

/* Controls of the Design surface's bars and of the workbench fallbacks
 * (connection banner, Automate v0 page), which were raw Tailwind buttons
 * with a 19.5%-white border. Values follow the reference's secondary
 * controls: 31px, 10px radius, --line border, --surface-2 fill, 10px text.
 * Selectors use the data-* attributes the components already carry. */

[data-design-workspace-tab-bar] {
  gap: 6px;
  min-height: 44px;
  height: auto;
  padding: 6px 8px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--line);
  background: var(--bg-soft);
}

[data-design-workspace-tab-bar] > * {
  flex-shrink: 0;
}

[data-design-workspace-tablist] {
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--surface);
}

[data-design-workspace-tab] {
  height: 26px;
  padding: 0 9px;
  border-radius: 9px;
  color: var(--muted);
  font-size: 10px;
  white-space: nowrap;
}

[data-design-workspace-tab][aria-selected="true"] {
  background: var(--surface-3);
  color: var(--text);
}

[data-design-workspace-tab-close] {
  color: var(--muted);
}

:is(
    [data-design-open-canvas],
    [data-design-open-terminal],
    [data-design-open-browser],
    [data-design-tool],
    [data-design-canvas-undo],
    [data-design-canvas-redo],
    [data-design-canvas-import-sketch]
  ) {
  display: inline-flex;
  align-items: center;
  height: 31px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 10px;
  white-space: nowrap;
}

:is(
    [data-design-open-canvas],
    [data-design-open-terminal],
    [data-design-open-browser],
    [data-design-tool],
    [data-design-canvas-undo],
    [data-design-canvas-redo],
    [data-design-canvas-import-sketch]
  ):hover:not(:disabled),
[data-design-tool][aria-pressed="true"] {
  border-color: var(--line-strong);
  background: var(--surface-3);
}

:is([data-design-canvas-undo], [data-design-canvas-redo]):disabled {
  opacity: 0.4;
}

[data-design-github-state] {
  display: inline-flex;
  align-items: center;
  max-width: 180px;
  height: 31px;
  padding: 0 10px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-v110="design-canvas-toolbar"] {
  gap: 6px;
  padding: 6px 8px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--line);
}
```

### T3.c — Import

**Fichier** : `packages/app/src/index.css`. Remplacer exactement :
```css
@import "@/styles/v110-live-orb.css";
```
par :
```css
@import "@/styles/v110-live-orb.css";
@import "@/styles/v110-surface-controls.css";
```

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts desk "[data-v110=\"rail-mode\"][data-mode=\"design\"]" "[data-design-open-canvas];;[data-design-workspace-tab]" C:/tmp/audit/t3-desk.png
node --experimental-strip-types docs/audit/tools/probe.mts mob "[data-v110=\"mobile-nav\"] [data-destination=\"design\"]" "[data-design-workspace-tab-bar]" C:/tmp/audit/t3-mob.png
```
Attendu :
- `data-design-open-canvas` : hauteur 31, bordure `1px solid rgba(255, 255, 255, 0.075)` en sombre, rayon `10px` ;
- sur mobile, la barre tient sur **une** ligne (hauteur ≤ 46) et `scrollWidth` vaut 390.

Ouvre les deux PNG : plus aucun bouton à bordure blanche.

**Commit** : `fix(ui): the Design bars take the v110 controls instead of raw buttons`
**Fichiers** : `packages/app/src/pages/workbench/design-canvas-tab.tsx`, `packages/app/src/styles/v110-surface-controls.css`, `packages/app/src/index.css`

---

## T4 — Bannière de connexion et page Automate v0 (P2, E1 style + E4)

**Fichier 1** : `packages/app/src/pages/workbench/connection-banner.tsx`. Sur le bouton de réessai, remplacer exactement :
```tsx
          class="rounded border border-border-base px-3 py-2 text-12-medium"
          aria-label={t("workbench.connection.retryHint")}
```
par :
```tsx
          data-v110="connection-retry"
          class="rounded border border-border-base px-3 py-2 text-12-medium"
          aria-label={t("workbench.connection.retryHint")}
```

**Fichier 2** : `packages/app/src/styles/v110-surface-controls.css`. Ajouter à la fin :
```css
/* Workbench connection banner's retry (connection-banner.tsx): a secondary
 * button sized to its label, never the full row. */
[data-v110="connection-retry"] {
  align-self: flex-start;
  width: auto;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
}

[data-v110="connection-retry"]:hover {
  border-color: var(--line-strong);
  background: var(--surface-3);
}

/* Automate v0 page (automate-surface.tsx fallback): cards, the node search
 * field and the node family chips. */
[data-v110="automate-surface"] :is([data-automate-node-library], [data-automate-runs], [data-automate-definition]) {
  border-color: var(--line);
  border-radius: 14px;
  background: var(--surface-2);
}

[data-v110="automate-surface"] [data-automate-node-library] input {
  height: 31px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font-size: 11px;
}

[data-v110="automate-surface"] [data-automate-node-library] span.rounded {
  border-color: var(--line);
  border-radius: 8px;
  background: var(--surface-3);
  color: var(--muted);
  font-size: 10px;
}
```

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts desk "[data-v110=\"rail-mode\"][data-mode=\"automate\"]" "[data-v110=\"connection-retry\"];;[data-automate-node-library] input" C:/tmp/audit/t4-desk.png
```
Attendu :
- `connection-retry` : hauteur 32, largeur inférieure à 200 ;
- champ de recherche : hauteur 31, rayon 10.

En dev web, le pont échoue : la bannière est visible, c'est normal.

**Commit** : `fix(ui): the workbench connection banner and the Automate fallback page use v110 controls`
**Fichiers** : `packages/app/src/pages/workbench/connection-banner.tsx`, `packages/app/src/styles/v110-surface-controls.css`

---

## T5 — Topbar de l'accueil (P1, A3/A4)

**Problème.** Sur l'accueil, l'app affiche les boutons de panneau gauche et inspecteur, sans objet (il n'y a pas de panneau), mais pas l'orbe, que la maquette place sur l'accueil.

### T5.a — Masquer les boutons de panneau sur l'accueil

**Fichier** : `packages/app/src/styles/v110-home.css`. Ajouter à la fin :
```css
/* Home has no context panel and no inspector: the reference's home topbar
 * keeps neither toggle. */
[data-v110="shell-frame"][data-route="home"]
  :is([data-v110="context-toggle"], [data-v110="inspector-toggle"], [data-v110="mobile-context-toggle"]) {
  display: none;
}
```

### T5.b — Orbe sur l'accueil

**Fichier** : `packages/app/src/components/titlebar.tsx`

1. Après la ligne `import { useTitlebarSlots } from "@/context/titlebar-slots"`, ajouter :
```ts
import { useMode } from "@/context/mode"
import { LiveOrb } from "./session/live-orb"
```
2. Dans le composant `Titlebar`, juste après la première ligne `const layout = useLayout()`, ajouter :
```ts
  const mode = useMode()
```
Vérifie d'abord que `const mode` n'existe pas déjà dans ce composant ; s'il existe, réutilise-le et saute ce point.

3. Remplacer exactement :
```tsx
      <div data-slot="topbar-center" class="min-w-0 flex items-center justify-center pointer-events-none">
        <div
```
par :
```tsx
      <div data-slot="topbar-center" class="min-w-0 flex items-center justify-center pointer-events-none">
        {/* The reference's home topbar carries the Live orb; in a session the
            orb comes with the layout switch through the centre slot. */}
        <Show when={mode.routeKind() === "home"}>
          <div class="pointer-events-auto flex">
            <LiveOrb />
          </div>
        </Show>
        <div
```

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts desk "" "[data-v110=\"live-orb\"];;[data-v110=\"context-toggle\"];;[data-v110=\"inspector-toggle\"]" C:/tmp/audit/t5-desk.png home
node --experimental-strip-types docs/audit/tools/probe.mts mob "" "[data-v110=\"live-orb\"];;[data-v110=\"mobile-context-toggle\"]" C:/tmp/audit/t5-mob.png home
node --experimental-strip-types docs/audit/tools/probe.mts desk "" "[data-v110=\"live-orb\"];;[data-v110=\"context-toggle\"]" C:/tmp/audit/t5-session.png
```
Attendu :
- sur l'accueil (PC et mobile) : **un** orbe de largeur supérieure à 0, et les boutons de panneau en `display: none` ou avec une boîte de largeur 0 ;
- en session : **un seul** orbe (pas deux) et le bouton de panneau gauche visible.

Un clic sur l'orbe de l'accueil doit l'animer (attribut `data-state="idle"`).

**Commit** : `fix(ui): the home topbar keeps the orb and drops the panel toggles, as in the reference`
**Fichiers** : `packages/app/src/styles/v110-home.css`, `packages/app/src/components/titlebar.tsx`

---

## T6 — Switch Chat/Editor sur téléphone (P2, A7)

Valeurs mesurées dans la maquette à 390 px :
- **groupe** : fond transparent, sans bordure, rayon 11 px ;
- **options** : hauteur 34 px, rayon 9 px, marges internes 0 8 px, texte 9 px.

Le contour de l'option active (anneau d'accent, ADR-048) est **conservé**.

**Fichier** : `packages/app/src/styles/v110.css`. Dans le bloc `@media (max-width: 599px), (max-width: 700px) and (orientation: portrait)` qui contient `[data-component="v110-topbar"] [data-v110="layout-switch"] {` (avec `flex: 1 1 auto;` et `height: 38px;`) :

1. Dans cette règle, remplacer `border-radius: 12px;` par :
```css
    border-color: transparent;
    border-radius: 11px;
    background: transparent;
```
2. Dans la règle suivante, `[data-component="v110-topbar"] [data-v110="layout-switch"] > [role="radio"] {`, remplacer :
```css
    height: 32px;
    border-radius: 10px;
    font-size: 11px;
```
par :
```css
    height: 34px;
    padding: 0 8px;
    border-radius: 9px;
    font-size: 9px;
```
Si les valeurs à remplacer ne sont pas exactement celles-ci, arrête-toi et consigne `BLOCKED T6` (le fichier a changé).

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts mob "" "[data-v110=\"layout-switch\"];;[data-v110=\"layout-switch\"] [role=\"radio\"]" C:/tmp/audit/t6.png
```
Attendu :
- groupe : fond `rgba(0, 0, 0, 0)`, rayon `11px` ;
- options : hauteur 34, police `9px`.

**Commit** : `fix(ui): the phone layout switch takes the reference's flat look`
**Fichiers** : `packages/app/src/styles/v110.css`

---

## T7 — Éditeur : barre d'état toujours là, bouton terminal sur téléphone (P1, B1/B3)

**Fichier** : `packages/app/src/pages/session/session-editor-surface.tsx`

1. Dans `export function SessionEditorSurface()`, remplacer :
```ts
  const { tabs } = useSessionLayout()
```
par :
```ts
  const { tabs, view } = useSessionLayout()
```
2. Remplacer exactement :
```tsx
        <Show when={active()}>
          {(tab) => <EditorStatusbar path={file.pathFromTab(tab())} />}
        </Show>
```
par :
```tsx
        {/* The reference keeps its status bar with no file open too. */}
        <EditorStatusbar path={active() ? file.pathFromTab(active()!) : undefined} />
```
3. Remplacer exactement :
```tsx
          <Show when={platform.platform !== "mobile"}>
            <TerminalPanel />
          </Show>
```
par :
```tsx
          <Show when={platform.platform !== "mobile"}>
            <TerminalPanel />
          </Show>
          {/* Phones have no topbar terminal button (the right slot is hidden
              there); the reference puts a floating one on the editor. Same
              icon as the topbar button (session-header.tsx). */}
          <button
            type="button"
            data-v110="code-terminal-fab"
            aria-label={language.t(view().terminal.opened() ? "terminal.toggle.hide" : "terminal.toggle.show")}
            aria-pressed={view().terminal.opened()}
            onClick={() => view().terminal.toggle()}
          >
            <Icon size="small" name={view().terminal.opened() ? "terminal-active" : "terminal"} />
          </button>
```
`Icon` est déjà importé dans ce fichier (utilisé par `EditorCodebar`). Vérifie-le avec `grep -n "import { Icon }" packages/app/src/pages/session/session-editor-surface.tsx` ; s'il manque, ajoute `import { Icon } from "@unifia/ui/icon"`.

**Fichier CSS** : `packages/app/src/styles/v110-editor.css`. Ajouter à la fin :
```css
/* Phone terminal button (session-editor-surface.tsx) -- the reference's
 * 44px floating button, 12px from the editor's bottom-right corner. */
[data-v110="code-terminal-fab"] {
  display: none;
}

@media (max-width: 599px), (max-width: 700px) and (orientation: portrait) {
  [data-v110="code-terminal-fab"] {
    position: absolute;
    z-index: 5;
    right: 12px;
    bottom: 12px;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--v110-card-line);
    border-radius: 14px;
    background: var(--v110-card-raised);
    color: var(--v110-card-text);
  }
}
```

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts mob "[role=\"radio\"]:has-text(\"Editor\")" "[data-v110=\"code-terminal-fab\"];;[data-v110=\"code-statusbar\"]" C:/tmp/audit/t7-mob.png
node --experimental-strip-types docs/audit/tools/probe.mts mob "[role=\"radio\"]:has-text(\"Editor\");;[data-v110=\"code-terminal-fab\"]" "#terminal-panel;;[data-v110=\"code-terminal-fab\"]" C:/tmp/audit/t7-mob-open.png
node --experimental-strip-types docs/audit/tools/probe.mts desk "" "[data-v110=\"code-terminal-fab\"]" C:/tmp/audit/t7-desk.png
```
Attendu :
- mobile : bouton de 44×44 et barre d'état visible, même sans fichier ;
- après le clic : `#terminal-panel` présent et visible ;
- PC : bouton en `display: none`.

**Si le terminal ne s'ouvre pas sur mobile** : retire le point 3 et la CSS du bouton, garde le point 2, et note-le dans le journal.

**Commit** : `fix(ui): the editor keeps its status bar with no file and gets the phone terminal button`
**Fichiers** : `packages/app/src/pages/session/session-editor-surface.tsx`, `packages/app/src/styles/v110-editor.css`

---

## T8 — Noms des projets récents sur l'accueil (P2, A9)

**Fichier** : `packages/app/src/pages/home.tsx`

1. Ajouter l'import (après les autres imports `@/pages/…`, ou à la fin du bloc d'imports) :
```ts
import { displayName } from "@/pages/layout/helpers"
```
2. Remplacer exactement :
```tsx
                    onClick={() => openProject(project.worktree)}
                  >
                    <span>{project.worktree.replace(homedir(), "~")}</span>
```
par :
```tsx
                    onClick={() => openProject(project.worktree)}
                    title={project.worktree.replace(homedir(), "~")}
                  >
                    <span>{displayName(project)}</span>
```

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts desk "" "[data-v110=\"home-quick-chip\"] span" C:/tmp/audit/t8.png home
```
Attendu : les textes ne contiennent plus de `\` ni de `~\` ; ce sont des noms de dossier ou de projet.

**Commit** : `fix(ui): home lists recent projects by name, the path moves to the tooltip`
**Fichiers** : `packages/app/src/pages/home.tsx`

---

## T9 — Surfaces à plat sur téléphone (P2, A10)

**Fichier** : `packages/app/src/styles/v110-editor.css`. Ajouter à la fin :
```css
/* Phones: the reference's mode surfaces sit flat, no rounded bordered card. */
@media (max-width: 599px), (max-width: 700px) and (orientation: portrait) {
  [data-v110="surface-card"] {
    border-color: transparent;
    border-radius: 0;
  }
}
```

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts mob "[data-action=\"mobile-more\"];;[data-mobile-action=\"settings\"]" "[data-v110=\"surface-card\"]" C:/tmp/audit/t9.png
```
Attendu : `radius` = `0px`. Sur PC, rien ne doit changer : relance `probe.mts desk "" "[data-v110=\"surface-card\"]" C:/tmp/audit/t9-desk.png` et vérifie un rayon de `18px` si une surface est présente.

**Commit** : `fix(ui): mode surfaces lie flat on phones, as in the reference`
**Fichiers** : `packages/app/src/styles/v110-editor.css`

---

## T10 — Champs de police des paramètres (P2, F1)

La maquette affiche le nom de la police en texte normal dans un champ `--surface-2`. L'app affiche un placeholder pâle, car la valeur vide signifie « police par défaut » : ce comportement ne change pas. Seul le rendu change.

**Fichier** : `packages/app/src/styles/v110-settings.css`. Ajouter à la fin :
```css
/* Interface / code font fields (settings-general.tsx): the reference's
 * 36px field on --surface-2. An empty field means "default font", shown by
 * its placeholder, so the placeholder reads as the value, like the reference. */
[data-slot="input-wrapper"]:has(> :is([data-action="settings-ui-font"], [data-action="settings-code-font"])) {
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
}

:is(input[data-action="settings-ui-font"], input[data-action="settings-code-font"]) {
  height: 34px;
  padding: 0 11px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 11px;
}

:is(input[data-action="settings-ui-font"], input[data-action="settings-code-font"])::placeholder {
  color: var(--text);
  opacity: 0.85;
}
```

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts desk "[data-v110=\"rail-mode\"][aria-label=\"Paramètres\"]" "input[data-action=\"settings-ui-font\"]" C:/tmp/audit/t10.png
```
Attendu : le champ mesure environ 34 px de haut, en police de 11 px. Sur la capture, le champ est au même fond que le sélecteur « Langue ».

**Commit** : `fix(ui): the settings font fields match the reference's field`
**Fichiers** : `packages/app/src/styles/v110-settings.css`

---

## T11 — Espaces du Compte sur téléphone (P2, F3)

**Fichier** : `packages/app/src/styles/v110-account.css`. **À l'intérieur** du dernier bloc `@media (max-width: 599px), (max-width: 700px) and (orientation: portrait) {` du fichier (celui qui commence par le commentaire `/* Phones -- V5 at 390px: the identity card goes`), juste avant son accolade fermante, ajouter :
```css

  /* "Vos espaces": Join and Create side by side, the session count under
   * the space's text. */
  [data-v110="account-frame"] [data-slot="account-space-actions"] {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  [data-v110="account-frame"] [data-slot="account-space"] {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  [data-v110="account-frame"] [data-slot="account-space-meta"] {
    grid-column: 2;
  }
```

**Vérifier** :
```bash
node --experimental-strip-types docs/audit/tools/probe.mts mob "[data-action=\"mobile-more\"];;[data-mobile-action=\"account\"];;[data-slot=\"account-quick-action\"]:has-text(\"Gérer\")" "[data-slot=\"account-space-actions\"] [data-slot=\"account-action\"]" C:/tmp/audit/t11.png
```
Le 3e clic ouvre « Gérer le compte », qui mène à la vue d'ensemble du centre de compte. Attendu : 2 boutons sur la **même** ligne (même `y`), chacun d'une largeur d'environ 170. `scrollWidth` vaut 390.

**Commit** : `fix(ui): account spaces lay out like the reference on phones`
**Fichiers** : `packages/app/src/styles/v110-account.css`

---

## 12. Clôture

1. Capture finale :
```bash
node --experimental-strip-types docs/audit/tools/capture.mts
python docs/audit/tools/pair.py
```
Ouvre chaque `C:/tmp/audit/*-pair.png`. Vérifie qu'aucune icône ni animation n'a changé par rapport à la capture de référence de l'étape 1.

2. Dans `docs/audit/EXECUTION-LOG.md`, ajoute un résumé : tâches OK, tâches BLOCKED avec leur raison. Commite et pousse.

---

## Hors plan (ne pas exécuter)

| Écart | Raison |
|---|---|
| A2 pastille « Auto · 2 », A5 switch dans Paramètres/Compte | Conservés à la demande explicite de l'utilisateur. |
| A6 switch Note/Graph de Memory | L'app n'a qu'un graphe local dans l'inspecteur, pas de vue Graph principale : il faudrait une surface nouvelle (PRD). |
| A8 avatar à initiale | Changerait une icône (interdit). |
| B2 champs de la barre d'état | Absence volontaire et documentée : pas de source de données. |
| B4 « → Work », B5 codelens, B6 pastilles éditeur mobile, B7 puces Memory du compositeur | Demandent une décision produit ou un moteur. |
| C2 sous-titre d'échéance Work | Aucune donnée d'échéance réelle. |
| D2/D3 refonte de la structure de Design | Chantier lourd (panneaux Structure/Design System, barre flottante) : spécification dédiée d'abord. |
| E1 Studio Automate, E3 Memory mobile | À vérifier sur l'exe desktop (pont natif) avant tout portage. |
| E2 Browser (GAP-01) | Capacité runtime absente. |
| F2 titre et fermeture de la liste des paramètres mobile | La barre du bas remplit déjà ce rôle. |
