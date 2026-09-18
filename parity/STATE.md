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

Caveat, stated plainly: this evidence was captured by driving the browser
manually, not by a committed script, so it is not a CI gate and cannot be re-run
by CI on this host (e2e remains blocked). The backend on :4096 was down
throughout and did not prevent these routes from rendering; only the workbench
bridge reported unavailable.

## Verdict

`NOT_QUALIFIED`. The harness is missing. Open the next session on `_a7-automate-memory`, branch `new-ui` at `aad67a5800caab473b95b0509a0c4564ba52d56a`, and enchaîner le complément F0 (Docker + Playwright dans l'image) puis S0 census → S1 G1/G2 → S2 tokens pre-freeze → QF0 → S3 home full re-play → S4–S12 visual polish → S13 responsive/DLR/locales étendu → S14 motion → S15 full qualification. Le verdict final `NEW_UI_PARITY_QUALIFIED / READY_FOR_PROMOTION_DECISION` viendra à l'achèvement de S15.