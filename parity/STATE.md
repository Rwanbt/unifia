<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors

Original work. No upstream derivation.
-->

# v110 parity state on `new-ui`

Generated: 2026-09-18 (current HEAD at the time of writing).

## Branch

- `new-ui` — every commit in this session lands directly on this branch (no feature branch, no worktree, no PR).
- Local HEAD and `origin/new-ui` HEAD stay aligned: a `git fetch` then `git rev-parse origin/new-ui == git rev-parse HEAD` is the pre-push gate.

## Browser verification -- 2026-09-18 (late)

The port was rendered in a real browser for the first time: backend on
:4096, Vite on :4444, Chromium at 1440x900. Three real defects surfaced that
the CSS-only work had hidden, and all three are fixed.

1. **Broken app (regression, mine).** Commit `f1928f6e7e` overwrote
   `packages/app/src/index.css` and dropped `@import
   "@unifia/ui/styles/tailwind"` plus the `getting-started` component layer.
   With no Tailwind pipeline, `max-w-[400px]` resolved to `none`, `fixed` to
   `static`, `shell:hidden` produced no rule, the shell collapsed and the
   mobile sidebar rendered at desktop width. Fixed in `29874507e9`. The
   regression was live on `origin/new-ui` from `f1928f6e7e` until that fix.

2. **Home was not full-bleed.** The shell rendered on the home route (the
   router wraps every route in `<Layout>`), so the home sat inside the
   workspace gutter below the context panel. Fixed in `29874507e9`:
   `layout.tsx` now emits `data-route={mode.routeKind()}` and sets
   `--main-left: 0px` on home; `v110-home.css` hides the desktop sidebar,
   the mobile sidebar, the workspace-tabs strip and the inspector on home,
   matching the maquette's `.app.show-home` rules.

3. **Light mode was unreadable.** `unifia-brand.css` defined dark-only
   `--text-primary` etc., and `v110-theme.css` targeted the maquette's
   `html[data-theme="light"]` while the app uses `html[data-color-scheme]`
   (A1-CONTRACT line 28). Fixed in `41626f480c`: the brand layer gains the
   maquette's light palette, the v110 theme layer targets the app's scheme.

Verified state after the fixes (measured, not eyeballed):

| Check | Home (dark) | Home (light) | Session |
|---|---|---|---|
| `overflowX` | 0 | 0 | 0 |
| `overflowY` | 0 | 0 | 0 |
| home size | 1439x506 | 1437x506 | n/a |
| mode pills | 6 | 6 | n/a |
| sidebar-nav-desktop | `display: none` | none | visible |
| sidebar-nav-mobile | `display: none` | none | hidden |
| workspace-tabs | `display: none` | none | visible |
| `--text-primary` | #F2EFED | #17171a | #F2EFED |

Also removed in `29874507e9`: the `home.glance` cards. They were invented in
this session; the frozen maquette's final home composition has no glance
block and explicitly neutralises the earlier `.home-glance` rules, so
shipping them would have been a fabricated addition presented as parity.

Closed after the verification pass:

- `5a172e5f14` ports the decorative Unifia symbol watermark behind the home
  launch column (maquette markup line 15273, rules 4784-4822).
- `cdf344033a` restores the simplified home topbar: brand wordmark on the
  left, theme toggle on the right (maquette #themeBtn, lines 4871-4880).
  The toggle was clicked in the browser and it flips data-color-scheme
  dark <-> light, repainting the whole surface correctly.

Correction to an earlier claim: the composer meta pills ARE "Build" /
"MiniMax-M3" / "Default" in the frozen maquette (line 15291-15293), so the
app already matched; the "Auto" I saw was the demo's runtime rewrite, not
the frozen markup.

Second correction, after reading the frozen topbar markup
(Unifia-UI-UX-v110-PORT-READY-R1.html lines 15226-15270): there is **no
GitHub link and no "Auto -2" server pill in the frozen topbar**. The topbar
ends at #themeBtn, then #topInspectorBtn, then `</header>`. The
`.app.show-home` rules explicitly hide #serverBtn, #openInBtn and the other
per-workspace chrome. What I read as "GitHub + Auto -2" in the demo
screenshot was runtime JS state, not the frozen markup. The app's home
topbar (rail toggle + Unifia wordmark + theme toggle) therefore **matches
the frozen maquette**; the earlier claim of a gap was wrong.

The recent-project chips are also not a gap: the maquette renders four
hard-coded demo chips ("Prism EQ / Code", "Guide OpenDesign / Design",
"Unifia Vault / Memory", "Réglages / Paramètres"). The plan's authority
order puts real behaviour above the maquette's demo data, so the app shows
real recent workspaces. That is an `intentional-difference`, not a missing
port.

Home interaction verified in the browser: clicking the "Code" pill raised
the project picker (dialog "Ouvrir un projet" over the directory list),
flipped the pill's aria-pressed to true, and left the URL on "/" until a
project is chosen. The six pills, the composer actions and the recent chips
all wire to the real handlers.

## Surface sweep -- 2026-09-18 (later)

Every shell mode and the settings overlay were opened in the running app and
inspected. Results, with the honest states preserved:

| Surface | Result | Notes |
|---|---|---|
| Home (dark / light / 1440 / 390) | renders | topbar, watermark, state line, title, composer, chips, 6 pills, hint |
| Home interaction | renders | clicking "Code" raises the project picker and flips aria-pressed |
| Theme toggle | renders | click flips data-color-scheme and repaints both palettes |
| Session / Code | renders | full shell: rail, context, chat, inspector, explorer, composer |
| Work | renders | view switcher (Apercu/Taches/Tableau/Chronologie/Activite/Executions), progression, next-safe-action, assistant |
| Design | renders | chat column + tabs (GitHub/Canvas/Terminal/Navigateur/Spec/Fichiers) + file search + canvas empty state |
| Automate | gated | renders "Mode d'espace de travail invalide" because workflow.run is not granted -- correct capability gating, not a fake |
| Settings | renders | 200px sidebar with groups, General page, appearance rows, version footer |

Two notes that are NOT defects:

- `FRAME` in the debug bar showed 1000ms on the routes I opened after the
  MCP reconnected. The metric is "worst frame gap over the last 5 seconds",
  and those tabs were backgrounded while another tab held focus, which stops
  requestAnimationFrame and inflates the first gap on refocus. The same bar
  read 5-8ms on the foregrounded home, and `LONG` stayed 0/0, so this is a
  measurement artifact, not a one-second main-thread block.
- One `TypeError: Failed to fetch dynamically imported module
  .../src/pages/session.tsx` appeared while I was editing titlebar.tsx with
  the page live. A reload cleared it; it is a Vite HMR transient, not a
  shipped defect.

Remaining visual gaps vs the frozen maquette: none identified for the home
surface. The Design canvas column is reserved by the grid but empty -- that
is the documented A6 gap in COMPONENT-MAP §8, and the panel shows an honest
"Sélectionne un fichier pour l'aperçu." rather than a fake render. The next
real work is the harness (F0) that can diff pixels, then S3-S12 for the
remaining surfaces.

## Correction -- 2026-09-18 (late)

An audit found that sessions 10 and 11 shipped 9 CSS layers whose class
hooks the app never references. The host-only liveness script
`parity/css-liveness.ts` compared every class defined in
`packages/app/src/styles/v110-*.css` against every source file in
`packages/app/src` and `packages/ui/src`: **192 inert class selectors out of
274**. The app renders Tailwind plus `@unifia/ui` primitives, not the v110
class names, so those layers were inert.

Two correction commits:
- `cd6810e872 fix(ui-parity-harness)` -- fixes the census marker regex
  (it skipped the JS object-literal form) and adds the dead-CSS detector to
  `tokens-audit` plus the `css-liveness` script.
- `f1928f6e7e fix(ui-parity)` -- deletes the 9 fully-inert layers, trims the
  7 partially-inert ones to their real `data-v110` anchors, retargets the
  browser layer to the real `data-design-browser` markup, and removes the
  dead `code-diff` rule. **Net -3074 LOC of inert CSS.**

CSS after the correction (11 files, ~1857 LOC):

| File | LOC | Targets |
|---|---|---|
| v110.css | 1064 | shell geometry, motion tokens, focus ring, A4 code tabs, terminal, mobile-diff |
| v110-home.css | 320 | `home`, `home-title`, `home-subtitle`, `home-state-line/dot`, `home-composer-*`, `home-meta-pill`, `home-icon-btn`, `home-send-btn`, `home-recent-row`, `home-quick-chip`, `home-modes-row`, `home-mode-pill`, `home-hint`, `home-empty`, `home-loading`, `home-glance`, `home-glance-cell` |
| v110-browser.css | 101 | `data-design-browser`, `-back`, `-forward`, `-reload`, `-address`, `-go`, `-error`, `-native`, `-frame` |
| v110-settings.css | 83 | `settings-dialog` + its `[role=tablist]` / `[role=tab]` / `[role=tabpanel]` |
| v110-inspector.css | 64 | `inspector-frame`, `inspector-tabs`, `inspector-content` |
| v110-mobile.css | 60 | `mobile-nav` |
| v110-chat.css | 49 | `chat-timeline`, `composer-dock` |
| v110-theme.css | 46 | light-theme overrides on the emitted anchors |
| v110-work.css | 24 | `work-view-shell`, `work-view-content` |
| v110-memory.css | 24 | `memory-panel` |
| v110-editor.css | 22 | `code-editor` |

`css-liveness` reports **0 inert class selectors**. `tokens-audit` reports
`deadDataV110Selectors: 8` (all pre-existing, out of this session's scope:
`composer`, `design-bezier`, `design-layers-panel`, `design-selection-handles`,
`design-split`, `design-vector-canvas`, `design-vector-toolbar`, `work-surface`)
and `unStyledDataV110Markers: 34` (markers the app emits that rely on Tailwind
rather than a v110 layer). Both lists are in
`parity/artifacts/tokens-audit.json`.

## Commits shipped this session

```
f1928f6e7e fix(ui-parity)         delete 192 inert v110 CSS class hooks
cd6810e872 fix(ui-parity-harness) fix census marker regex + add dead-CSS detector
8a9f2ed641 ui-parity(S0)          ship extended census with data + aria + role + handler + class
2062ef4656 ui-parity(work-primitives) add v110 kanban + timeline + accordion + kbd + slider CSS (deleted)
4ff6236f3d ui-parity(content)    add v110 chip + breadcrumb + pre + table chrome CSS (deleted)
af309326ce ui-parity(skeleton)  add v110 skeleton + spinner + progress + empty-state CSS (deleted)
b94b1bf75f ui-parity(form)      add v110 switch + checkbox + radio + toggle chrome CSS (deleted)
5cb00235c5 ui-parity(controls)  add v110 button + input + badge + card chrome CSS (deleted)
2a1bae1518 ui-parity(state)     refresh STATE.md after i18n + select + dialog + editor + S15-prep
63288f79b4 ui-parity(editor)     add v110 editor + statusbar + theme-toggle chrome CSS
8049ede27f ui-parity(S15-prep)  add v110 anchor surface test (8 contract anchors + CSS layer count)
47d6146bb6 ui-parity(dialog)    add v110 modal dialog chrome CSS as separate layer
8c3cbd2e08 ui-parity(select)    add v110 select / menu / popover / tooltip chrome CSS
e5df2d3f2d ui-parity(i18n)      ship homeDict as a separate i18n module for v110 keys
ef550e5455 ui-parity(state)     refresh STATE.md after home + workflow + L0+QF0
29f7e12f68 ui-parity(L0+QF0)    extend parity:lock:refresh to fill both contract locks
bcb8fa1e5e ui-parity(home)      add home.glance surface test (3 stat cells + matrix)
60f73b81bf ui-parity(home)      extract home CSS to v110-home.css + add home.glance cells
8e2f1b714d ui-parity(state)     refresh STATE.md for the v110 work after A12
25c8ca13e1 ui-parity(workflow)  wire parity:checkpoint:lint into .husky/pre-commit
8bcfb036e3 ui-parity(palette)   add v110 command palette chrome CSS as separate layer
5ba4117882 ui-parity(S3)        add v110 home full re-play surface test (5x3x2x3 matrix)
84d82ca3e4 ui-parity(theme)     add v110 light-theme overrides as separate layer
5e5c4ea81e ui-parity(S14)       ship v110 motion static sampler + npm script parity:motion:static
699678ff2c ui-parity(mobile)    add v110 mobile nav + overlay + toast chrome CSS
2fa6ea63d9 ui-parity(inspector) add v110 inspector frame chrome CSS as separate layer
d5494aa41c ui-parity(QF0)       ship full-contract-lock with PENDING-F0 markers
b8428cc891 ui-parity(A12)       add v110 browser surface chrome CSS as separate layer
ac53d3a1f5 ui-parity(S2)        ship v110 tokens pre-freeze audit + npm script parity:tokens:audit
0208d3495b ui-parity(S0)        ship static census engine + npm script parity:census
f12fbe1327 ui-parity(A10)       add v110 settings dialog chrome CSS as separate layer
2aa1be26ce ui-parity(A11)       add v110 automate a60 studio chrome CSS as separate layer
7a285b7d10 ui-parity(A9)        add v110 memory surface chrome CSS as separate layer
b3b7b92991 ui-parity(L0-refresh) fill real sha-256 hashes into the pilot contract lock
4e6e78e3f9 ui-parity(state)    record the L0 pilot lock + A4/A5 chrome in STATE.md
ac12038445 ui-parity(L0)        ship pilot-contract-lock as lock-only file
1a843c5912 ui-parity(A5)        add v110 work surface chrome CSS as separate layer
9342a3779b ui-parity(A4-c)     add v110 chat thread + composer chrome CSS as separate layer
af7340076e ui-parity(S3-light) wire home data-state machine (loading/empty/ready)
44539f4ec1 ui-parity(state)    document v110 parity state on new-ui
aad67a5800 ui-parity(S14)      add v110 motion contract CSS + reduced-motion surface test
7e7d941ec3 ui-parity(A4-b)     add v110 code-tabs strip chrome to v110.css
5a2126914b ui-parity(F0-c)     populate state-policy, motion-policy, style-profiles on new-ui
acfef9bdf9 ui-parity(A4-a)     add v110 code/terminal/diff chrome CSS to v110.css
9d6a7788d7 ui-parity(S13)      add responsive surface test covering the v110 matrix
01a547e726 ui-parity(S7-S11)   mark v110 work / memory / automate / settings anchors
395961e0c0 ui-parity(S6)       mark v110 code anchors (editor/terminal/diff) + surface test
62331c0592 ui-parity(S5)       mark v110 chat anchors + add chat surface test
7c633e0d97 ui-parity(S4)       mark the four canonical v110 shell anchors + surface test
fddea89058 ui-parity(F0-b2)    wire v110 parity runners and npm scripts on new-ui
10176a5166 ui-parity(F0-b1)    expand v110 path classification to 100% coverage on new-ui
00d6ef7058 ui-parity(F0-a2)    ship JSON schemas for the v110 result/run/lock contracts
a7f03094de ui-parity(F0-a1)    ship JSON schemas for the v110 policy files on new-ui
cc5468217c ui-parity(V0-b)     rewrite home with v110 hero + composer + 6-pill row + surface test
75790ce8de ui-parity(V0-a)     add v110 home surface CSS to the shell contract
d578babdb4 ui-parity(PF0)      ship v110 parity baseline + policies on new-ui
```

52 commits, all atomic (one -- F0-b1 -- exceeds 400 LOC by design to keep the path-classification taxonomy coherent; the others stay under budget). Both locks (L0 + QF0) land as lock-only files with PENDING-F0 markers for the hashes that F0 must compute.

## What is in place

### Visual port

- **V0 Home** rewritten to match the maquette v110-port-ready-r1 hero + composer + 6-pill row. Three pilot anchors wired: `data-parity="home.title"`, `home.modes-row`, `home.mode-pill`. Home CSS classes (`[data-v110="home*"]`) live in `packages/app/src/styles/v110.css`. The data-state machine (loading | empty | ready) and shimmer overlay round out the chrome.
- **A4 Code chrome** (terminal card, head, resize handle, editor card, diff card, code-tabs strip, chat thread, composer) — CSS additions to `v110.css`, `v110-chat.css`, and the rest of the layer split aligned with the maquette's `#codeArea / .terminal-shell / .terminal-head / .tab / .terminal-resize-handle / .msg / .composer` selectors.
- **A5 Work / A9 Memory / A10 Settings / A11 Automate / A12 Browser / inspector / mobile / palette / theme** — one CSS file per surface (A5 work-hero + panel + task + agent + progress-card; A9 vault + note + memory-tabs + graph-svg; A10 settings-dialog + settings-nav + settings-section + setting-row; A11 a60-studio + a60-head + a60-body + a60-lib + a60-lib-node; A12 browser-workspace + browser-tabbar + browser-tab + browser-favicon + browser-tab-close + browser-new-tab + browser-address-bar; inspector inspector-frame + insp-tab + inspector-section + setting-row; mobile mobile-nav + overlay + toast; palette .palette + .palette-input + .palette-list + .cmd + .cmd-icon + .cmd kbd; theme html[data-theme=light] overrides on every contract selector).
- **S14 Motion contract** — `--v110-split 680ms / --v110-micro 150ms / --v110-soft 220ms / --v110-easing cubic-bezier(.16,.84,.2,1)` tokens, kill-switches for `prefers-reduced-motion` and `html[data-ui-animations="off"]`, transition properties on the contract selectors. The static sampler (parity:motion:static) records the contract coordinates for the F0 image-side sampler.

### Markers (data-parity) — harness can match every anchored surface

| Surface | Anchor |
|---|---|
| Home | `home.title`, `home.subtitle`, `home.modes-row`, `home.mode-pill`, `home.composer-card` |
| Shell | `shell.topbar`, `shell.workspace-tabs`, `shell.rail`, `shell.inspector` |
| Chat | `session.composer`, `session.chat` |
| Code | `code.editor`, `code.terminal`, `code.diff` |
| Work | `work.shell`, `work.content` |
| Memory | `memory.panel` |
| Automate | `automate.surface` |
| Settings | `settings.dialog` |

### Surface tests (`packages/app/e2e/v110/`)

- `home.spec.ts` — three pilot anchors visible + 6 stable pills + focus-visible on the design pill.
- `shell.spec.ts` — four shell anchors visible + inspector frame mounted + topbar/rail widths match the v110 contract.
- `chat.spec.ts` — chat + composer anchors visible + vertical order respects the shell frame.
- `code.spec.ts` — code.editor / code.terminal / code.diff anchors attached.
- `surfaces.spec.ts` — work / memory / automate / settings anchors reachable.
- `responsive.spec.ts` — five canonical viewports (desktop-wide / desktop-compact / tablet-portrait / phone-portrait / compact-landscape); no horizontal overflow at any of them; topbar height stays ≤ 72 px.
- `motion.spec.ts` — motion tokens exist on `:root` at the v110 contract values; `data-ui-animations="off"` collapses every token to 0 ms; shell.inspector carries a transition that uses a v110 token.

### F0 infrastructure

- `parity/environment-lock.json` — pinned maquette hash, runtimes, clock, locales, fonts, network.
- `parity/baseline.json` — repo state at PF0.
- `parity/path-classification.json` — 100+ rules; `parity:path-classification:check` reports 7636 / 7636 tracked files classified.
- `parity/{probe-policy, mutation-spec, census-merge-policy, generated-paths-policy, g0-derivation-policy, design-ownership, reference-locale-capabilities, branch-policy-snapshot, execution-budget, state-policy, motion-policy, style-profiles}.json` — every required policy populated.
- `parity/schemas/*.schema.json` — JSON Schema 2020-12 for every policy and every contract lock, run, result.
- `parity/authority-map.md` — sources of truth and the prohibition on app-as-reference.
- `parity/pilot-contract-lock.json` — L0 lock (39 hashes computed, aaCalibrationHash + aaPrimeHash PENDING-F0).
- `parity/full-contract-lock.json` — QF0 lock (all hashes PENDING-F0; locks the F0 toolchain).
- `packages/app/scripts/parity/` — 10 runners (`shared`, `environment-check`, `contract`, `path-classification-check`, `g0-mode-derive`, `checkpoint-lint`, `generated-verify`, `census-run`, `tokens-audit`, `motion-static`, `lock-refresh`, `runtime`).
- `packages/app/package.json` — 18 `parity:*` npm scripts reachable (including parity:census, parity:tokens:audit, parity:motion:static, parity:lock:refresh, parity:contract, parity:checkpoint:lint, parity:path-classification:check, etc.).
- `parity/artifacts/` — host-side artefacts `census-static.json` (243 markers, 937 handlers, 17 anchors across 617 files), `tokens-audit.json` (101 declarations, 24 unique v110-* tokens, 357 selectors), `motion-static.json` (243 markers sampled), `path-classification-coverage.live.json` (last coverage), `runtime-{census,aa,aa-prime,visual}.json` PENDING_IMPL stubs.
- `.husky/pre-commit` — wires `parity:checkpoint:lint` into the v110 gate; refuses INVALID_CHECKPOINT for harness + UI or policies + UI mixed in the same range, and refuses unclassified paths.

## What is still missing

### G0 — qualified visual parity

The harness has not been built. The runners for `parity:census`, `parity:aa`, `parity:aa-prime`, `parity:visual`, `parity:motion`, `parity:mutations`, `parity:g3`, `parity:full` are explicit `PENDING_IMPL` stubs — they cannot be silently PASS, they wait for the Docker image + Playwright in image + A/A calibration + BrowserContext isolation + motion sampler + pixel engine + mutations to land.

### L0 — pilot lock

`parity/pilot-contract-lock.json` IS written as a lock-only file with PENDING-F0 markers for `environmentLockHash`, `aaCalibrationHash`, `aaPrimeHash`, plus every policy and schema hash. The plan and toolchain commits are pinned (`8cc914c0ea` and `1a843c5912`). The lock cannot certify any surface on its own per §30; V0 (home pilot) is the only surface proven by it, the rest stays NOT_RUN.

### QF0 — full qualification lock

`full-contract-lock.json` is not written. The `fullToolchainCommit` and `fullContractLockHash` variables stay `null`. Until the full suite is recorded, no full lock.

### S0 — global census

The S0 Census tool writes `parity-result.json` `census.hash`, `census.untrackedReferenceNodes`, `census.untrackedAppNodes`. None of these exist yet.

### S1 — G1 / G2 engine

`bun run parity:contract` validates schemas, but the G1 schema gate (schema errors, cardinality errors, pairing errors, etc.) and G2 visual engine (BrowserContext isolation, motion sampler, pixel engine, heatmaps) are not implemented.

### S2 — tokens / Tailwind / fonts pre-freeze

Tailwind v4 + the `--v110-*` token contract are wired in `v110.css`. The pre-freeze audit (TypeScript Compiler API + PostCSS parser) does not exist yet — the harness check is still pending.

### S3 — Home re-play in full

V0 (Home) was the pilot run on the matrix. S3 re-plays Home in the full profile (all states × all viewports × all themes × all locales × all DPRs × motion). Until the harness, only the structural anchors land.

### S4 — shell global

Shell markers + surface test are in place. The full shell visual port (topbar actions, rail buttons, panel resizer, inspector content chrome) is not done.

### S5 — session / chat

Chat markers + surface test are in place. The chat thread visual port (message bubbles, avatar, artifact cards, observability options) is not done.

### S6 — code

Code anchors + chrome CSS + surface test are in place. The Code surface visual port (editor pane chrome, gutter, terminal head actions, inline-AI permission gating, ghost Next Edit, autocomplete dropdown) is not done.

### S7 — work

Work anchors + surface test are in place. The Work surface visual port (work-hero, panel chrome, kanban board, timeline activity, runs table) is not done.

### S8 — design

Design ownership is `PENDING` (per `parity/design-ownership.json`). The v110 chrome that Design may touch is listed in `chromeAllowlist`; the canvas runtime is not wired (per COMPONENT-MAP §8).

### S9 — memory

Memory anchor + surface test are in place. The vault / notes / graph / backlinks / drag-drop chrome is not done.

### S10 — settings / user

Settings anchor + surface test are in place. The settings dialog chrome (general / audio / shortcuts / memory / providers / models / configuration / benchmark / observability / mcp / skills / hooks / compute) is not done.

### S11 — automate

Automate anchor + surface test are in place. The Automate capability surface (studio a60, header / library / canvas / runbar / minimap / inspector / debug tabs) is not done.

### S12 — browser

Browser runtime is `unknown` per `parity/design-ownership.json`. The WebView-backed DesignBrowserTab lives in `packages/app/src/pages/workbench/design-browser-tab.tsx`. No v110 marker or test of surface yet.

### S13 — responsive

Responsive matrix test is in place. Full matrix (5 viewports × 2 themes × 3 locales × 2 DPRs × motion) is not done.

### S14 — motion

Motion contract CSS + surface test are in place. Full motion sampling (Animation.currentTime + intermediate sample points) is not done.

### S15 — full qualification

`parity-result.json` is not written. `verdict` is not set. `NEW_UI_PARITY_QUALIFIED` is not reached.

## S0 gate hardening (this session, 2026-09-18)

Five harness defects found and closed on `new-ui`. Each was mutation-proven:
the gate was made to FAIL on a deliberately corrupted input, then restored and
confirmed to PASS. A gate that cannot fail is not a gate.

1. `parity:manifest:check` added (new) -- validates fragment shape, cross-refs
   (anchorKind -> state-policy, styleProfile -> style-profiles), and that every
   app `data-parity` marker is fragmented or a recorded finding.
   16 fragments, 18 markers, 14 fragmented + 4 findings = 18/18 covered.
2. The same gate made bidirectional -- every fragment's app selector must name a
   marker the census actually discovered (92 data-parity + data-v110 keys).
   Catches dangling contracts that would never pair at runtime.
3. The same gate made fail-closed on a missing census. It previously guarded the
   coverage and reverse checks with `existsSync`, so a checkout without a prior
   `parity:census` run silently lost both checks. Now an explicit error.
4. `parity:path-classification:check` fixed to COMPARE its baseline. It claimed
   in its own header to reconcile against `parity/path-classification-coverage.json`
   but never read the file -- it regenerated and overwrote it every run, so drift
   was undetectable and the tree was dirtied by a fresh `capturedAt` each time.
   Now: substantive-field comparison ignoring `capturedAt`, live result written to
   the gitignored `.live` artifact, tracked baseline written only under `--refresh`
   (which accepts the drift it reports and exits 0; CI never passes it).
   `classificationCounts` keys sorted for order-independence -- adopting that
   canonical form is why the baseline was refreshed in the same commit.
5. Repaired a broken string literal in item 4's file: an em-dash had round-tripped
   to U+FFFD + quote through an earlier edit and terminated the string early.
   Replaced with an ASCII hyphen. Lesson: keep string literals ASCII-only; this
   host's toolchain mangles non-ASCII through some edit paths.

`parity:evidence:host` now runs 12 gates and reports overall PASS.

Considered and rejected -- do not re-litigate. Six gates show `status: null` in
the bundle (census-run, tokens-audit, motion-static, census-extended, unit,
g0-mode-derive). This is NOT fail-open. `evidence-host.ts:139` derives `overall`
from `exitCode`, exactly as the file header states ("overall is PASS iff every
gate exits 0"); declared statuses are recorded verbatim for information. Those
gates emit artifacts rather than stdout JSON, so there is no status to parse.
exitCode is the authority; that is documented and intentional.

Still open, unchanged: e2e UNVERIFIED on this host (Playwright chromium hangs
under bun on this Windows box; `npx playwright install chrome` is
privilege-blocked). Runtime fragment/DOM pairing remains the S1 G1 runner's job
-- the manifest gate proves the contract statically, not the DOM at runtime.
F0 Docker harness absent. Product approval still missing for the three
intentional-difference dispositions and the `code.diff` reference strategy.

## Runtime pairing evidence (manual, this session)

Purpose: the S1 G1 runner is unbuilt and e2e is blocked on this host, but the host
CAN drive a real browser through the brave-devtools MCP. Fragments were paired
against the live DOM directly. That is how the shell.rail defect below was found:
the static manifest gate cannot see this class of problem.

Method (repeatable): Vite dev server on http://127.0.0.1:4444, emulated viewport
1440x900x1 (the "desktop-wide" the fragments declare), dark scheme unless stated.
An element counts as visible only when display != none, visibility != hidden, and
its rect width and height are both > 0. Each fragment is queried with its exact
declared app selector.

CORRECTION: an earlier draft of this section claimed "11 anchors paired". That was
wrong. It counted two anchors that exist only as findings (shell.workspace-tabs,
session.composer) as if they were fragments. No fragment exists for either, so
neither can be paired. There are 16 fragments, and the accurate figure is 12.

12 of the 16 fragments paired exactly (raw/visible vs declared):

  Route "/" -- data-route="home", dark, 1440x900:
    home.title 1/1, home.subtitle 1/1, home.modes-row 1/1, home.mode-pill 6/6,
    home.composer-card 1/1, home.state-line 1/1
  Route "/<project>/session" -- dark, 1440x900:
    shell.topbar 1/1, shell.rail 1/1 (was 2/1 before the fix), shell.inspector 1/1
  Route "/<project>/work" -- dark, 1440x900:
    work.shell 1/1, work.content 1/1
  Settings dialog opened over /work -- dark, 1440x900:
    settings.dialog 1/1

Observed in the DOM but NOT pairable, because no fragment exists for them:
shell.workspace-tabs 1/1 and session.composer 1/1 on the session route. Recorded
as observation only, not as evidence of parity.

Not paired, and why:
  code.editor, code.terminal -- not mounted on a session with no file open.
  memory.panel, automate.surface -- gated. With no project open, clicking a mode
  pill on home opens the "Ouvrir un projet" dialog instead of switching mode
  (confirmed for both Work and Automate). In the open-project session route the
  rail exposes only Code, Travail and Design, and no affordance reaches Memory or
  Automate, so those surfaces are unreachable in this workspace. Capability
  gating, not a regression.
  Design mode renders at /design but has no fragment, so there is nothing to pair.
  Its empty canvas column is the already-documented A6 gap, not a new finding.

Defect found and fixed in 1c8172e31a: data-parity="shell.rail" was emitted by both
the desktop and the mobile instantiation of SidebarContent, so the bare selector
matched 2 elements. Beyond the harness, this would have failed shell.spec.ts and
anchors.spec.ts under Playwright strict mode, which rejects a locator resolving to
2 elements.

Screenshots captured this session live in docs/ui-reference/v110/verification/
(home dark, home light, work, settings, design).

Caveat, stated plainly at the time: this evidence was captured by driving the
browser manually, not by a committed script. The following session (below)
closed that gap.

## Runtime pairing harness committed and made deterministic (2026-09-18, Claude Code session)

`packages/app/scripts/parity/runtime-pair.ts` existed only as an uncommitted,
non-deterministic file (HANDOFF-CLAUDE.md §4: three consecutive runs against
one browser gave `12/0/4`, then `10/2/4`, then a hard throw). Both documented
defects are fixed, plus two more found while actually proving determinism:

1. **Order-dependent theme.** The old `ensureTheme()` clicked the app's
   toggle button (home-only, flips relative to `theme.mode()`), racing the
   app's own "system"-scheme reactivity and sometimes pinning the wrong
   explicit value into `localStorage`, which then outlived the run. Replaced
   with `page.addInitScript` writing `unifia-color-scheme`
   (`packages/ui/src/theme/context.tsx` `STORAGE_KEYS.COLOR_SCHEME`) directly
   before every navigation.
2. **Fixed wait after navigation.** `waitForTimeout(1200)` replaced with
   `waitForFunction` on the shell frame's `data-route` reaching the kind
   `parseModeLocation()` assigns the URL, then -- because that alone still
   measured home fragments as raw 0 (the outer shell mounts before the
   scene's own content does) -- `waitForSelector` on each fragment's own
   selector right before measuring it.
3. **Viewport ordering (found proving determinism, not in the original two).**
   A freshly created CDP page defaults to a narrow viewport (758x488 measured
   on this host); `settings-general.tsx` renders `<SettingsMobileNav>` below
   its mobile breakpoint, which carries no `data-parity="settings.dialog"`
   marker. The settings scene opened the dialog via a keypress before its own
   per-fragment loop would have set the viewport. Viewport is now resolved
   and applied once, up front, the same way theme is.
4. **Tab leak across runs (same category).** `browser.close()` detaches the
   CDP session but does not close the page on a CDP-attached browser: 3
   consecutive runs left 15 tabs open, each retrying its failed connection to
   the down `:4096` backend, until a later navigation failed with
   `net::ERR_INSUFFICIENT_RESOURCES`. Added `page.close()` in the same
   `finally`.

Also: a scene whose readiness wait times out now records FAIL for its own
fragments and moves on, instead of throwing uncaught and losing every other
scene's outcome (this is the shape the documented third run's "hard throw"
took).

**Proof, exactly as required**: 3 consecutive runs against the same isolated
browser (CDP `:9333`, never `:9222`), same command, same `--project`:
`12/0/4`, `12/0/4`, `12/0/4`, exit 0 every time. The tab-leak fix was
confirmed separately (2 residual targets after 3 runs, not the 15+ an
unfixed leak leaves). Committed harness-only in `463821e886`, after a
pre-existing, unrelated `path-classification` baseline drift (two
doc/screenshot commits had shifted the tracked-file count without a
`--refresh`) was closed first in its own commit (`8b7ea8baeb`), and the
harness commit's own new tracked file was reconciled in a third
(`fcb3da8c4a`).

`parity:evidence:host` then gained the harness as an **optional, non-gating**
report (`691a9d151f`), per HANDOFF-CLAUDE.md §9.6: a new `optionalGates`
array runs `runtime-pair` only when `PARITY_RUNTIME_CDP` and
`PARITY_RUNTIME_PROJECT` are both set (otherwise `SKIPPED_NO_ENV`), and is
excluded from both `overall` and the canonical hash -- a normal or CI run of
`parity:evidence:host` is unaffected either way. Two more bugs surfaced
wiring this in and were fixed in the same commit: `evidence-host.ts` runs
under bun, so `process.execPath` resolved to `bun.exe` -- the exact
combination `runtime-pair.ts`'s own header documents as broken -- so the
child process is now hardcoded to `"node"`; and `runtime-pair.ts` wrote its
JSON to stderr on FAIL (every sibling `parity/scripts/*.ts` runner always
writes to stdout and lets the exit code carry pass/fail), which would have
made evidence-host report `status: null` on a genuine failure instead of
real counters -- fixed to always write stdout.

Still true, unchanged by this session: e2e UNVERIFIED on this host
(`chromium.launch()` hangs under bun, `npx playwright install chrome` is
privilege-blocked); F0 Docker harness absent; product approval still missing
for the three `intentional-difference` dispositions and the `code.diff`
reference strategy; the backend on `:4096` was down throughout this session
too (the harness's `code.editor` / `code.terminal` BLOCKED outcomes and the
`automate.surface` / `memory.panel` capability-gated BLOCKED outcomes are
unchanged from HANDOFF and are the same honest, non-regressed state).

## S4/S8 visual-polish increments (2026-09-18, same Claude Code session, after the harness fix)

The human picked "continue S4-S12 visual polish, small atomic commits" over
generalizing the CDP harness workaround into S1 G1/G2 (an architecture
decision requiring separate human approval -- not attempted). Every item
below was found by actually driving the app in the isolated CDP browser
(`:9333`) side by side with the frozen maquette, not by guessing from code:

- **S4 topbar** (`b35cd2493b`): the session-header.tsx file-search trigger
  (portals into the titlebar center slot, matches the maquette's `#searchBtn`
  affordance) had no search icon, unlike every other search input in the app,
  and `cursor-default` on a clickable button. Both fixed; verified in-browser
  (icon renders, computed cursor is `pointer`).
- **Home i18n** (`b00801e73e`): `i18n/home.ts` (`homeDict`/`tHome`) was dead
  code -- never imported. `home.tsx` hardcoded its hero title, subtitle,
  composer placeholder/actions and hint directly in English, bypassing i18n
  entirely, while every other string on the page (state line, empty/loading,
  mode pills) correctly localized. Rewrote `home.ts` as a real per-locale
  dict (en authoritative, fr sourced verbatim from the frozen maquette) with
  English fallback for every other locale, and wired all five spots.
- **Workbench bridge banner i18n** (`c98e4ffd7d`): `WorkspaceWorkbenchProvider`
  froze `bridgeErrorValue` as a plain `const` built from `t(...)` at init,
  so it permanently captured whatever the (async-loading) locale dictionary
  returned at that instant -- English, even after French finished loading.
  Confirmed live on the Work surface. Fixed by computing the message fresh
  on every read; `bridgeUnavailable` (the boolean) stays frozen, which is
  correct and documented (avoids a reconnect loop an earlier audit caught).
- **`sdk-unwrap.ts` i18n** (`cf4c4bdec6`): the shared `unwrap()` helper (26
  call sites across 6 observability/memory settings panels) hardcoded
  "Request failed" in English always. Fixed by reading
  `document.documentElement.lang` (kept in sync by `context/language.tsx`)
  since this plain utility runs outside any component's reactive scope and
  cannot call `useLanguage()`. Added `sdk-unwrap.test.ts` (none existed).
- **Design workbench i18n** (`d4eeb4057d`): cleared the exact three files
  `i18n/parity.test.ts`'s own `FRENCH_UI_WORD` guard comment named as
  tracked debt -- `design-artifact-tab.tsx`, `design-surface.tsx`,
  `design-toolbar.tsx` -- ~35 strings mixing hardcoded French and hardcoded
  English in the same JSX. Added `i18n/design-artifact.ts` and
  `i18n/design-approval.ts` (same per-locale-with-fallback pattern as
  `i18n/home.ts`, needed because `en.ts`/`fr.ts` are already past the
  AGENTS.md 1500 LOC ceiling). Widened `GUARDED_DESIGN_FILES` to include all
  three; mutation-proved (reintroduced "Annuler", confirmed the guard fails,
  restored the fix, confirmed it passes).
- Two `path-classification` baseline refreshes for the new tracked files
  along the way, kept in their own policy-only commits per this branch's
  commit discipline.

**Not fixed, flagged as a follow-up task** (spawned, not attempted): the
Design Assistant panel still hardcodes French regardless of locale in at
least `connection-banner.tsx:29` ("Disponible dans l'application desktop"),
`workbench-thread.tsx:487` ("Aucun skill"), and a "Commenter" button in
`thread-comment-attach-panel.tsx` / `workbench-thread.tsx`. Not in the #99
guard's documented scope, so left for a dedicated pass rather than folded
into this batch.

Full unit suite (1636 tests, 185 files) and typecheck stayed green
throughout; each fix was verified live in the browser (both `locale=en` and
`locale=fr` where applicable) before committing.

## Pixel-perfect phase: real bugs, a new tool, and a hard scope boundary (2026-09-18)

User's standing directive this phase: the sole objective is pixel-perfect
parity against the frozen maquette, pursued rigorously. Scope so far: Home
only.

**Two real, verified bugs found and fixed on Home:**

1. `packages/app/src/styles/v110.css` (around line 1043) contained a
   JS-style `//` comment, invalid in CSS. This silently broke Tailwind's
   `@tailwindcss/vite:generate:serve` transform for the *entire* bundled
   `index.css` -- Vite kept serving a stale-but-successfully-compiled
   bundle from before the comment was introduced, with no error surfaced to
   normal requests. Found only because Vite was restarted (user-approved
   exception to `packages/app/AGENTS.md`'s "never restart" rule) after
   proving via a cache-bust marker that disk edits were not reaching the
   served CSS at all. Fixed: `/* ... */`.
2. `packages/app/src/styles/v110-home.css`'s `[data-v110="home"]` rule was
   missing `flex: 1` inside its flex-column parent (`[data-v110="workspace"]`
   / `<main>`), so it sized to content (548px measured) instead of filling
   the 850px available -- `place-items: center` then centered inside an
   undersized box, landing the hero ~185px above the maquette's actual
   vertical center. Fixed by adding `flex: 1; min-height: 0;`, matching the
   maquette's own `.home-screen` pair (lines 3995-4001 / 4382-4386).

Home diff after both fixes: **2.04%** (`parity/artifacts/pixel-diff/home-*`,
gitignored). Residual is the already-adjudicated real-project-vs-demo-chips
difference and the demo-only "Auto · 2" topbar pill -- not chased further.

**New tool: `packages/app/scripts/parity/pixel-diff.ts`**
(`bun run --cwd packages/app parity:pixel:diff`). Screenshots the frozen
maquette and the live app at matched viewport/theme/locale over the same
isolated CDP browser `runtime-pair.ts` uses, diffs with `pixelmatch`. This
is the closest practical substitute for the blocked S1 G2 Docker visual
engine on this host. It carries the same host-resource-ceiling health check
as `runtime-pair.ts` (throws instead of silently diffing a starved render).
Extended this session with `--maquette-mode=<mode>` (calls the maquette's
own `window.unifiaEnterWorkspace(mode)`, since the maquette is one static
demo file that starts on its home screen and has no URL-addressable routes)
and separate `--maquette-ready=` / `--app-ready=` selectors (the two sides
never share a "this surface finished mounting" DOM convention).

**Hard scope boundary found, not a bug: Workbench-bridge-gated surfaces
cannot be pixel-diffed via this browser-only harness.**
Navigated the real app interactively (Home -> open project ->
"Mode Travail") and via `pixel-diff.ts` at `/<project>/work`. Both show
`workbench.errors.bridgeUnavailable` ("Le pont Workbench est indisponible
pour cet espace de travail") instead of the maquette's populated Work board
(plan/agents/progression grid). Root cause, read directly:
`packages/app/src/context/workbench/provider.tsx:56` --
`const bridgeUnavailable = !platform.workbench`. `platform.workbench` is a
Tauri-only native binding; it does not exist when the app is loaded in a
plain browser against the Vite dev server, which is exactly how this
harness (and `runtime-pair.ts`) drives it. The measured 6.91% diff for
`work` is therefore evidence of nothing -- it is comparing the maquette's
demo content against an environment fallback screen, not against the app's
real, possibly-already-ported Work UI. **Do not trust or re-report that
6.91% figure.** Pixel-diffing any Workbench-bridge-gated surface (Work
executions, likely Code file operations, Automate, Memory -- STATE.md
already recorded Memory/Automate as capability-gated for other reasons)
needs the actual Tauri desktop build running, not this CDP-over-Vite
harness. This is a real, new blocker of the same kind as the F0 Docker gap
-- record it, do not silently work around it.

**Correction, found and fixed within this same phase**: the `work` and the
first `session` diff runs above used
`--app=http://127.0.0.1:4444/4b0ea68d7af9a6031a7ffda7ad66e0cb83315750/...`
-- `4b0ea68d7af9a6031a7ffda7ad66e0cb83315750` is a project **id** from the
backend's `GET /project`, not what the app's own router expects. Read
directly: `packages/app/src/context/mode-directory.ts:29` decodes the first
path segment with `base64Decode` (`packages/util/src/encode.ts:7-11`, a
base64url variant) into a filesystem directory path. A hex project id
happens to be valid base64url alphabet, so it silently decoded into a
garbage-but-truthy directory instead of throwing -- the app then tried to
treat that garbage string as a real project path. This, not host resource
starvation, is the more likely cause of the earlier
`TypeError: Failed to fetch dynamically imported module` on `/session`.
**The earlier "unverified, possible resource ceiling" framing for that
failure is superseded by this -- the actual bug was in the test URL.**
Correct form: `base64Encode(worktreePath)` (same file, line 1-5), e.g.
`D:\App\unifia\unifia` -> `RDpcQXBwXHVuaWZpYVx1bmlmaWE`. Confirmed by
decoding the app's own tab title after opening that project by hand and
by a matching `node` computation. With the corrected URL, `/session`
loads cleanly and repeatably -- no further resource-ceiling symptoms
observed once the project segment was right.

**Settings dialog, corrected URL**: `parity:pixel:diff --name=settings`
(maquette via `--maquette-mode=settings`, app via
`--app-key=Control+Comma` on `/RDpcQXBwXHVuaWZpYVx1bmlmaWE/session`) ->
**5.58%** (`parity/artifacts/pixel-diff/settings-*`). Screenshots compared
directly. The dialog's own content is close: same field set on the
Général tab (Langue, Développer shell/edit, Animations, Schéma de
couleurs, Thème), same visual language (`dialog-settings.tsx` already
carries `data-v110` markers). Two real, sourced, NOT-yet-fixed gaps drive
most of the remaining diff, both bigger than a CSS nudge:
1. **Category grouping differs.** App: two groups (Bureau; Serveur, which
   bundles Fournisseurs/Modèles/Configuration/Remote access/Se
   connecter/Benchmark/Observabilité/Mémoire/Plugins together). Maquette:
   four groups (Bureau; IA; Infrastructure; Extensions) that split what the
   app calls "Serveur" apart. A few maquette-only fields are also missing
   app-side (Couleur d'accent, Police de l'interface, Police de code,
   Observabilité du chat's granularity picker).
2. **No persistent left conversation panel.** The maquette renders Settings
   (like Work) as a split view: a permanent left "Conversation" chat-thread
   column plus the mode's own content on the right, inside the same shell
   frame the maquette uses for every mode. The app renders Settings as a
   dialog/panel over the session view (composer peeking below, dimmed
   backdrop) with no such split -- confirmed this is not simply an unstyled
   v110 component: `layout.tsx:1006` (`data-v110="shell-frame"`) and
   `titlebar.tsx:176` (`data-v110="topbar"`) already wrap every route, home
   included, and the app's single topbar has no per-mode breadcrumb
   ("Prism EQ / Paramètres"), no Chat/Split/Editor toggle, and no status
   pill -- these are simply not built yet for non-home routes, not a
   partially-applied style.

Not a bug, already adjudicated (STATE.md above, "Observed in the DOM but
NOT pairable"): the topmost workspace-tabs row (Accueil/master/new-ui/...)
visible in the app screenshots is `workspace-tabs-bar.tsx`, itself
`data-v110`-tagged -- a real, intentional multi-workspace-tab feature with
no maquette equivalent, not an unported legacy holdover. It inflates the
settings/session diff percentage without being a defect.

**Net effect on scope**: Home (2.04%) and now Settings (5.58%, gaps
identified and sourced above) are pixel-diff-verified. Work remains
blocked on the Tauri-desktop requirement. The Settings result surfaces a
scope-level question -- whether Settings/Work should adopt the maquette's
persistent-conversation split layout -- that is bigger than incremental
CSS work and needs a product decision, not a silent fix. Verdict below is
unchanged by this phase: still `NOT_QUALIFIED`, now for an additional,
explicit reason -- pixel parity has only been measured for two surfaces
out of the 16-fragment manifest, and one of the two open gaps is
architectural, not cosmetic.

**`code.default` (the default Code/chat view) attempted, result discarded
as not meaningful.** Diffed at 3.83% (`parity/artifacts/pixel-diff/code-*`)
but the comparison is unfair on its face: the app side is a brand-new
session with no history (`Créez ce que vous voulez`, no open file), while
the maquette shows its usual populated demo (an in-progress Rust editing
session with file tabs, git status, tests). A low diff number here reflects
two different kinds of empty/simple screens, not agreement. Confirming
real Code parity needs a session with an actual file open, which needs the
file-search/open flow to work -- see next paragraph for why that wasn't
reachable this session.

**Unrelated bug found while trying to open a file for that comparison, not
investigated further, spawned as a follow-up task instead of chased here**:
one of the app's own open workspace tabs (`workspace-tabs-bar.tsx`) has a
corrupted directory segment -- decodes towards
`D:\App\unifia\_a7-automate-memory\packages\unifia\` followed by U+FFFD
replacement-character garbage instead of a real path. With that tab
focused, `Ctrl+P` file search hangs forever on "Chargement" and
`GET /global/event` (the SSE stream) loops `net::ERR_ABORTED`. Likely the
same class of non-ASCII round-trip bug HANDOFF-CLAUDE.md's Windows gotchas
section already documents, but happening at runtime in whatever persists
open workspace tabs rather than in an editor tool. Not chased further --
orthogonal to pixel-perfect visual parity, and this session was already
deep into unrelated territory. Left for a dedicated investigation.

## Topbar and rail, element by element (2026-09-18)

User asked to continue the pixel-perfect pass one shell element at a time,
starting with the topbar and the left rail. Read the maquette's topbar
markup directly (`Unifia-UI-UX-v110-PORT-READY-R1.html:15226-15270`) and
its `.app.show-home` hide-list (`lines 4013-4027`) to get the actual
contract instead of guessing from screenshots, then compared element by
element against `packages/app/src/components/titlebar.tsx` (topbar) and
`packages/app/src/pages/layout/sidebar-shell.tsx` (rail).

**Two real bugs found and fixed, both in the topbar**: the brand logo
(`<Logo/>`) and the theme toggle button were both wrapped in
`<Show when={home()}>`, so opening any project made them disappear
entirely -- confirmed live (screenshot before/after,
`theme.setColorScheme` toggle exercised on a non-home route). This was
backwards: reading the maquette's own `.app.show-home` CSS rule shows it
hides `.crumbs`, `#layoutSwitch`, the inspector toggles and the
`#topExplorerBtn`/`#topReviewBtn`/`#topTerminalBtn`/`#serverBtn`/
`#openInBtn`/`#topInspectorBtn` group *on home*, and never targets
`.brand` or `#themeBtn` at all -- meaning the frozen design keeps brand
and theme visible on **every** route, home included, and only hides the
workspace-specific chrome on home (the opposite of what the app's
`home()` gate did for these two elements). Fixed by removing both
`<Show>` wrappers; this made the `home` memo and its `useMode()` call
dead, so both were removed too (`de2c1f0a19`). Full unit suite stayed
green (1636 tests).

**Bigger topbar gaps found, not fixed -- out of scope for a CSS-level
pass**: the maquette's `.crumbs` (breadcrumb: **Project** / Mode),
`#workspaceTitle`/`#workspaceMeta` (bold mode title + subtitle), and
`#layoutSwitch` (the Chat/Split/Editor/Graph view toggle -- the control
that puts chat and the code editor side by side) have **no equivalent at
all** in `titlebar.tsx` for non-home routes; nothing to un-hide, these
elements were never built. `#serverBtn` (the "Auto · 2" pill) is already
adjudicated demo-only JS state, not a gap. The app's own top-right icon
group (`Basculer le terminal`, `Basculer la revue`, `Basculer
l'arborescence des fichiers`) does map functionally to the maquette's
`#topTerminalBtn`/`#topReviewBtn`/`#topExplorerBtn`, just in a different
position and without the matching visual language -- not chased, since
building breadcrumb/title/view-switch is new UI development, not a fix,
and (like the Settings finding above) needs a product decision on
whether non-home routes should adopt the maquette's persistent
conversation-plus-content-plus-view-switch shell at all.

**Rail: closer to the maquette than it first looked.** Read
`sidebar-shell.tsx` and measured live button positions
(`getBoundingClientRect` on `Mode Code`/`Mode Travail`/`Mode Design`,
`Paramètres`, `Aide`): the skeleton matches -- mode icons at the top,
a flex spacer, then bottom-anchored actions -- and the earlier "totally
different rail" impression from a screenshot was simply a misreading of
which icon was which. Two small, real, sourced gaps, neither fixed:
1. **No avatar.** The maquette's rail has a user-avatar button
   (`.rail-avatar-wrap`, a demo initial) between "+" and Settings. The
   app has no equivalent, and no `currentUser`/avatar concept exists
   anywhere in the app's source to wire one to (checked
   `settings-collaborative-auth.tsx` and grepped for `avatar`/`useAuth`/
   `useAccount` -- nothing). Inventing placeholder identity UI with no
   real data behind it would be worse than the gap; left alone.
2. ~~Browser and Memory modes have no dedicated icon~~ -- **correction**:
   this was wrong, based on misreading the ternary as a 6-mode switch. Read
   `packages/workbench-shell/src/modes.ts:13`: `ShellMode` is a strict
   4-entry union (`"code" | "work" | "design" | "automate"`), confirmed by
   its own comment ("still the 4-entry contract"). Browser and Memory are
   maquette-only rail concepts with no corresponding `ShellMode` at all --
   `sidebar-shell.tsx`'s icon ternary's `"checklist"` fallback is reached
   only by `automate`, never by a mode that doesn't exist in the type
   system. No gap to fix here.

## Topbar breadcrumb ported (2026-09-18)

`.crumbs` (`Unifia-UI-UX-v110-PORT-READY-R1.html:15232`) is now real,
tested UI, not just a documented gap: `components/topbar-breadcrumb.tsx`
(`f9531f32b8`), a new `left` slot on `titlebar-slots.tsx`, bare-noun i18n
keys (`workbench.modes.name.*`) added to English and all 16 other
locales with real distinct translations (workbench.* is in the i18n
parity guard's audited scope, so an English fallback would have failed
CI). Verified live in French on both Code and Work modes ("unifia /
Code", "unifia / Travail"); full unit suite (1636 tests) and the i18n
parity suite (10 tests, 33030 assertions) both green.

**Investigated, deliberately not attempted this pass**: the maquette's
`#layoutSwitch` (Chat/Split/Editor/Graph). Traced the app's actual backing
state before deciding -- `context/layout.tsx` has a real per-session file
tabs model (`SessionTabs.all`/`.active`) and a real `editorFocus`
toggle (`session-header.tsx`, "tablet mode": hides chat to give the open
inspector tab more room) -- so this is not vaporware, there is a genuine
feature underneath. But `editorFocus` only appears when
`layout.inspector.opened()`, and what it maximizes is the inspector panel
(explorer/inspector/execution), not confirmed to be an actual open-file
code view the way the maquette's "Editor" state is.

**Superseded below**: the caution above (not building it without first
confirming what "Editor" shows) was right procedurally, but the user
pushed back hard on stopping at "close" instead of "identical" --
correctly: the underlying question ("what does the app actually render
for an open file") didn't need answering to build a HONEST control, only
to know whether it would misrepresent itself. It doesn't: `editorFocus`
already, today, hides the chat panel and maximizes whatever the inspector
shows -- true regardless of what that content turns out to be. Built it.

## Topbar/rail finished to "identical," not "close" (2026-09-18, same day)

Four more real ports landed after the user explicitly rejected "close
enough" as a stopping point:

1. **Chat/Split/Editor** (`b38ccc407d`). Read the maquette's own
   `UnifiaLayoutControllerV79` script (module 070) to get its real
   semantics: `.mode-shell.chat-only` / `.main-only` / neither, and
   confirmed Graph is force-hidden everywhere outside memory mode ("the
   historical Graph button never belongs to the global layout selector").
   Mapped the 3 real states onto `layout.inspector`/`layout.editorFocus`,
   the exact same two signals the single icon-toggle button next to it
   already used -- replaced that button rather than duplicating it.
   Verified live: all 3 states toggle correctly.
2. **Rail account avatar** (`d188d633bc`). Checked exhaustively first: no
   user identity, no accounts, no session manager anywhere in this
   codebase (platform bindings, Rust desktop backend, settings, git-config
   reads -- nothing). Rather than fabricate an identity or a dead menu,
   drew a generic person glyph (same reason titlebar.tsx hand-draws its
   own sun/moon icons) and wired it to open Settings, the nearest real,
   honest destination.
3. **Workspace title + meta tagline** (`f9ffa46ea8`). First attempt
   visually overlapped the search bar at 1280px -- root cause was the
   titlebar-slots portal target being `shrink-0`, so new content doesn't
   compress, it overflows the grid track (CSS Grid does not clip an auto
   track just because an ancestor says `min-w-0`). Fixed with an explicit
   `max-width` + `overflow-hidden` on the new block itself (clips
   unconditionally) and empirically raised its breakpoint to `2xl` after
   confirming there measurably isn't room below that.
4. Brand/theme visibility and the breadcrumb itself (documented above,
   `de2c1f0a19` / `f9531f32b8`) are the other two pieces of this same push.

All four verified live in the browser and against the full unit suite
(1636 tests) at each step, not just typechecked. Topbar and rail are now
at genuine parity for every element that has a real, honest destination
in this app. What's still open is unchanged from above: Work/Design/
Automate/Memory content stays blocked on the Tauri desktop bridge, and
Settings' persistent-conversation-split layout remains a product-scope
question, not a CSS fix.

## Follow-up i18n pass: one fixed, one correctly refused (2026-09-18)

Picked up the spawned follow-up recorded above ("remaining Design Assistant
French strings"). Read all three cited call sites before touching any of them,
and they are NOT one class of problem -- two are real inconsistencies, one is a
deliberate decision that is enforced by a test.

**Fixed: the skill-picker fallback (7456a20790).**
`workbench-thread.tsx:487` rendered `"Aucun skill"` as the skill-picker
trigger label when nothing was selected, in a file that already binds `t` at
line 132 for every one of its other strings. That is a genuine inconsistency.
New key `workbench.thread.skill.none`, translated into en plus all 16 other
locales rather than falling back to English.

Did NOT reuse `settings.fork.plugins.noSkills` ("No skill installed"): that key
belongs to the plugins list where "installed" carries the meaning, and a picker
trigger with nothing selected is a different state. Sharing it would have been a
false sharing of knowledge, which is exactly the DRY failure AGENTS.md warns
about.

Verified live, both directions, by driving the app's own persisted locale and
reloading (not by mutating the DOM): locale=fr renders "Aucun skill",
locale=en renders "No skill". Before this change it read "Aucun skill" in both.
Unit suite unchanged at 1636 pass / 0 fail / 185 files; i18n/parity.test.ts
10/10, including the per-locale translation-parity guard that proves the 17 new
entries are complete.

**Correctly NOT fixed: `connection-banner.tsx:29`.**
It hardcodes `"Disponible dans l'application desktop"`, but this is not an
oversight and must not be "cleaned up" by a future session without an explicit
decision. `provider.test.ts:155-163` asserts BOTH that the literal is present
AND that no `workbench.connection.unsupported` key is introduced, citing a
"V10 (visual contract)" phase. Searching the repo, that V10 phase does not exist
anywhere -- the note is a forward-looking plan from V03 that never materialised.

Converting it therefore requires editing a test that encodes a scope decision.
That is a product/scope choice, not a mechanical fix, so it is surfaced here
instead of overridden. Note the neighbouring phases (ready/connecting/retrying/
failed) all DO use `t(...)` already, so `unsupported` is the lone exception.

**Separation of concerns, recorded because it is easy to conflate:** the third
cited site, `thread-comment-attach-panel.tsx` ("Commenter la conversation"),
belongs to the comment/design-comment family (`comment-panel.tsx`,
`comment-popover.tsx`) which is French-only by an explicit, documented
convention -- its own header says so and notes the parity test does not cover
it. `comment-panel.tsx` and `comment-popover.tsx` confirmed to use no i18n at
all. That is a batch conversion with a product question attached (should that
whole surface be localised?), not a drive-by string fix.

**Guard-coverage gap found while verifying, worth its own task.**
The #99 guard that is supposed to catch exactly this class scans only five
hardcoded filenames in `GUARDED_DESIGN_FILES` (design-browser-tab,
design-files-tab, design-artifact-tab, design-surface, design-toolbar). Every
other file under `pages/workbench` is unguarded, which is why
`connection-banner.tsx` and `workbench-thread.tsx` both slipped through.
The guard's own comment calls the allowlist "how a guard gets deleted" -- the
allowlist is the weakness, not the regex. Widening it needs care (the comment
family would fail it by design), so it is recorded rather than changed here.

## Guard widened after two more real i18n bugs (2026-09-18, same day)

Continuing the follow-up i18n work: the previous note said the #99 guard had a
coverage gap. This session closed it for the two files that were already
cleared, not by guessing but by finding more bugs first.

**More bugs found by broadening the search before touching the guard:**
1. `workbench-thread.tsx:503-504` -- the attach button carried hardcoded
   French aria-label and title ("Joindre un fichier") on a button whose file
   already binds `t`. Fixed by reusing `prompt.action.attachFile`, which
   exists in all 17 locales with the exact French value -- no new key.
2. `workbench-thread-list.tsx` -- five hardcoded French strings on action
   buttons (Copier, Regenerate/Hint, Helpful, NeedsImprovement) AND three
   visible state strings (empty-thread, next-steps heading, next-steps hint).
   All eight routed through new `workbench.thread.*` keys, with translations
   in all 17 locales. Note that "Copier" was a new key rather than reusing
   `terminal.selection.copy`: that key is semantically scoped to terminal
   selection, and a thread list button is a different control -- reusing it
   would be a false sharing of knowledge.

**Decisions to reuse rather than duplicate:**
- `prompt.action.attachFile` (already all 17 locales, French is "Joindre un
  fichier") for the thread attach button.
- `workbench.thread.copy` rather than `terminal.selection.copy` -- same
  reason as the previous session's `workbench.thread.skill.none` vs
  `settings.fork.plugins.noSkills`: the keys belong to different controls.

**Guard widened (`b4a0712af5`)** to cover workbench-thread.tsx and
workbench-thread-list.tsx, after both were cleared, following the guard's own
comment ("Widen this set only after clearing a file the same way; widening
without that fails on files nobody has fixed yet, which is how a guard gets
deleted"). Mutation-proven in the previous session's harness discipline.

**Discipline correction (`014454db94`):** the widening was originally in the
same commit as the UI fix (`fc59794528`), violating this branch's harness+UI
separation rule. Corrected with two follow-up commits -- one to remove the
widening, one to re-add it -- so each commit carries one intent. Verbose but
traceable, and preferred over a force-push / interactive rebase of pushed
history.

**Honestly recorded mid-process defects, not hidden:**
1. First edit pass used `lastIndexOf("}")` as the insertion point. Six
   locales (de, ko, no, tr, zh, zht) end with `} satisfies
   Partial<Record<Keys, string>>`, so the keys landed after the satisfies
   clause and broke the syntax. A follow-up pass parsed the actual object
   literal by brace matching and reinserted correctly. The final state is
   clean and the parity test confirms it, but the intermediate broken state
   would have shown up in typecheck had I caught it earlier -- I did not.
2. The same brace-matching parser initially used a wrong arity (incomplete
   translations map) and threw a value-undefined error, which left the
   locales in their broken state and aborted before any write. That threw
   cleanly before any commit, which is what saved this from a worse
   outcome, but the misleading "all green" that came from a crude
   `node -e` syntax check on the sliced object literal is itself recorded:
   the check passed because the satisfies clause was outside its slice.
   Real validation was the i18n/parity.test.ts 10/10 run plus bun typecheck.

Verified: bun typecheck exit 0; full unit suite 1636 pass / 0 fail / 185
files; i18n/parity.test.ts 10/10; manifest:check PASS.

## Pixel-perfect topbar/rail: stopped mid-refactor (2026-09-18, same day)

Continued the topbar/rail pixel-perfect pass. Read the maquette topbar
(lines 15226-15270) and rail (15326-15350), built a static gap analyser
(`parity/artifacts/pixel-diff/topbar-rail/gap.mjs`), and started the
single-row flex refactor of `titlebar.tsx`.

**Outcome: zero net progress.** The attempted change broke visually in
the browser -- theme toggle landed on the wrong side, elements ordered
incorrectly, the back/forward and Nouvelle-session real navigation
features were stripped -- and was reverted. The tree is clean against
`985d528dc1`; nothing was committed. The broken state is preserved as
`parity/artifacts/pixel-diff/topbar-rail/app-topbar-flex.png` so the
next attempt can see what to avoid.

**Why the static gate didn't catch it**: typecheck exit 0 and the full
1636-test unit suite stayed green throughout. The only signal that
matters for layout is the live browser. Recorded honestly rather than
hidden -- the next session should verify in the browser after every
structural topbar change, not just at the end.

**Honest re-framing of pixel-perfect**: this is a one-row flex in the
maquette vs a 3-grid-columns-with-portals layout in the app. The
mismatch is structural, not a one-line fix. Three options were laid out
in the handoff (full single-row flex refactor; explicit-width 3-column;
accept the gap at 1440 and document the breakpoint above which parity
holds). The user asked for option (a). The next session picks it up but
must plan to verify after every step.

Captured at HEAD = `985d528dc1`; 127 commits; tree clean; vault note
records this as a fifth session of 2026-09-18.

## Topbar ordering fixed with measured proof, not a screenshot guess (2026-09-19)

User rejected "close" outright: "tu n'as vérifié que l'existence... pas
leurs placements ni leur esthétique" (you only verified existence, not
placement or aesthetics). Correct -- prior verification in this file was
screenshots and `getBoundingClientRect` spot-checks on isolated elements,
never a systematic position comparison against the maquette.

Picked up right where MM2-B02-WORKER's abandoned attempt (`a98e513f88`)
left off, but did not repeat their approach (full single-row flex
refactor of `titlebar.tsx`, which is what broke for them). Instead: drove
the maquette live over CDP, called `getBoundingClientRect()` +
`getComputedStyle().order` on every `.topbar` child at 1440x900. Finding:
every element is `order: 0` -- no CSS `order` anywhere in the maquette --
so visual order is exactly DOM order. Measured `layoutSwitch` (Chat/Split/
Editor) at x=745, directly after the search bar and BEFORE `.top-actions`
(explorer/review/terminal/theme, starting x=1175). The app had the
opposite: icon cluster before the switch, theme after it -- the switch
and theme sat on opposite sides of where the maquette puts them together.

Fixed (`36975e84b3`) by moving the Chat/Split/Editor JSX block in
`session-header.tsx` to render right after the title/meta pair, before
the icon cluster -- content reorder only, zero changes to
`titlebar.tsx`'s slot/grid architecture, avoiding the exact failure mode
that sank the other attempt. Verified with the same method that found the
bug: measured live positions after the fix (switch at x=966, theme last
at x=1399) instead of trusting a screenshot.

Also measured and fixed (`b1fe15990f`): `.search { width: min(380px,
32vw) }` (line 126) renders 380px at 1440px viewport; the app had a
hardcoded 240px, a real 140px gap. Fixed to the same `min()` function
(not a bare pixel value), so it still narrows correctly on a smaller
window instead of overflowing. Verified live: 240px before, 380px after.

**Still open, honestly**: the Chat/Split/Editor pill measures 143px wide
against the maquette's 119px -- likely `text-11-medium` (11px, this
codebase's convention) vs the maquette's literal 9px font-size plus a
slightly larger padding scale, not chased further this pass since it is
a deliberate type-scale consistency choice, not an oversight, but it is
a real, still-unclosed 24px gap and should not be quietly assumed fixed.
Left-side elements (rail toggle, brand, "Nouvelle session") were not
compared 1:1 against the maquette's `toggleRailBtn`/`showContextBtn`
because the app has real, additional navigation features (back/forward,
new session) the maquette's static demo doesn't need -- absolute x
position there is not a meaningful comparison, only relative order and
explicit sizes are.

## Full button inventory both sides, two more real gaps closed (2026-09-19)

User: "il manque encore des boutons, il y a encore des boutons non voulu
et leurs placements n'est pas identique" (buttons still missing, unwanted
buttons still there, placement still not identical). Did a complete
button inventory on both sides this time -- every `<button>` in
`[data-v110="topbar"]` and `[data-v110="rail"]`, not a spot check -- to
answer this precisely instead of arguing about it.

**Fixed**:
1. (`1ed2e4ac23`) `.top-actions` order. Maquette:
   `#topExplorerBtn, #topReviewBtn, #topTerminalBtn, #serverBtn`
   (Unifia-UI-UX-v110-PORT-READY-R1.html:15248-15251). App rendered
   Status, Terminal, Review, FileTree -- exactly reversed for the three
   matching icons, Status on the wrong side too. Reordered to FileTree,
   Review, Terminal, Status. Verified with the full ordered label list,
   not one element.
2. (`a41d630383`) Removed the desktop rail's Help icon. The maquette rail
   (15326-15350) is exactly mode icons, spacer, Nouveau, avatar,
   Réglages -- no help icon at all. This app added one with no maquette
   basis. Not a silent deletion: the same GitHub link is still reachable
   from the error page. Scoped to desktop only -- kept on mobile, which
   has no maquette reference in this pass.

**Found, not yet acted on -- flagged instead of guessed at**:
- `#showContextBtn` (Unifia-UI-UX-v110-PORT-READY-R1.html:17149-17152)
  toggles a left "context" panel independently from the mode rail
  (`toggleRailBtn`). Read its handler: `shell.classList.toggle
  ('hide-context')`, a second, separate collapse target from the rail.
  The app has one combined sidebar toggle (`layout.sidebar.toggle`); it is
  not yet established whether the app has an equivalent second panel to
  wire a second toggle to, or whether this needs new state. Left open
  rather than fabricating a toggle for a panel that may not exist.
- Topbar's "Nouvelle session" and "Copier le chemin": real, working,
  keybind-registered features with no maquette equivalent at all (the
  maquette is a static demo with no sessions to create and no external
  editor to open into). Not removed, unlike the rail's Help icon -- the
  difference is these have no working substitute path if removed (Help's
  GitHub link still exists on the error page; there is no equivalent
  fallback for creating a session or copying the project path), and
  removing a live keybind's only visible entry point is a different, more
  consequential kind of scope decision than removing a redundant support
  icon. Recorded explicitly rather than silently kept.

## Verdict

`NOT_QUALIFIED`. The harness gap that blocked runtime pairing from being a
committed, re-runnable check is closed (`691a9d151f`), and six real,
verified i18n/visual bugs found while doing S4/S8 visual polish are fixed as
of `1329ef531c` on `new-ui` (pushed to `origin/new-ui`). Open the next
session on `_a7-automate-memory`, branch `new-ui` at `1329ef531c`. Two
independent threads are ready to pick up:
1. The spawned follow-up task (remaining Design Assistant French strings).
2. Continue S4-S12 visual polish the same way (drive the app in the
   isolated CDP browser side by side with the frozen maquette, fix what's
   actually wrong, verify live, small atomic commits) -- or enchaîner le
   complément F0 (Docker + Playwright dans l'image) puis S0 census → S1
   G1/G2 → S2 tokens pre-freeze → QF0 → S3 home full re-play → S13
   responsive/DLR/locales étendu → S14 motion → S15 full qualification.
F0/e2e both need a human decision before they can proceed (Docker
availability, `chromium.launch()` privilege block) -- do not silently invent
a workaround for either. Le verdict final `NEW_UI_PARITY_QUALIFIED /
READY_FOR_PROMOTION_DECISION` viendra à l'achèvement de S15.