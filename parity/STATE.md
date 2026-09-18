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

## Commits shipped this session

```
29f7e12f68 ui-parity(L0+QF0)      extend parity:lock:refresh to fill both contract locks
bcb8fa1e5e ui-parity(home)       add home.glance surface test (3 stat cells + matrix)
60f73b81bf ui-parity(home)       extract home CSS to v110-home.css + add home.glance cells
8e2f1b714d ui-parity(state)      refresh STATE.md for the v110 work after A12
25c8ca13e1 ui-parity(workflow)   wire parity:checkpoint:lint into .husky/pre-commit
8bcfb036e3 ui-parity(palette)    add v110 command palette chrome CSS as separate layer
5ba4117882 ui-parity(S3)         add v110 home full re-play surface test (5x3x2x3 matrix)
84d82ca3e4 ui-parity(theme)      add v110 light-theme overrides as separate layer
5e5c4ea81e ui-parity(S14)        ship v110 motion static sampler + npm script parity:motion:static
699678ff2c ui-parity(mobile)     add v110 mobile nav + overlay + toast chrome CSS
2fa6ea63d9 ui-parity(inspector)  add v110 inspector frame chrome CSS as separate layer
d5494aa41c ui-parity(QF0)        ship full-contract-lock with PENDING-F0 markers
b8428cc891 ui-parity(A12)        add v110 browser surface chrome CSS as separate layer
ac53d3a1f5 ui-parity(S2)         ship v110 tokens pre-freeze audit + npm script parity:tokens:audit
0208d3495b ui-parity(S0)         ship static census engine + npm script parity:census
f12fbe1327 ui-parity(A10)        add v110 settings dialog chrome CSS as separate layer
2aa1be26ce ui-parity(A11)        add v110 automate a60 studio chrome CSS as separate layer
7a285b7d10 ui-parity(A9)         add v110 memory surface chrome CSS as separate layer
b3b7b92991 ui-parity(L0-refresh) fill real sha-256 hashes into the pilot contract lock
4e6e78e3f9 ui-parity(state)     record the L0 pilot lock + A4/A5 chrome in STATE.md
ac12038445 ui-parity(L0)         ship pilot-contract-lock as lock-only file
1a843c5912 ui-parity(A5)         add v110 work surface chrome CSS as separate layer
9342a3779b ui-parity(A4-c)      add v110 chat thread + composer chrome CSS as separate layer
af7340076e ui-parity(S3-light)  wire home data-state machine (loading/empty/ready)
44539f4ec1 ui-parity(state)     document v110 parity state on new-ui
aad67a5800 ui-parity(S14)       add v110 motion contract CSS + reduced-motion surface test
7e7d941ec3 ui-parity(A4-b)      add v110 code-tabs strip chrome to v110.css
5a2126914b ui-parity(F0-c)      populate state-policy, motion-policy, style-profiles on new-ui
acfef9bdf9 ui-parity(A4-a)      add v110 code/terminal/diff chrome CSS to v110.css
9d6a7788d7 ui-parity(S13)       add responsive surface test covering the v110 matrix
01a547e726 ui-parity(S7-S11)    mark v110 work / memory / automate / settings anchors
395961e0c0 ui-parity(S6)        mark v110 code anchors (editor/terminal/diff) + surface test
62331c0592 ui-parity(S5)        mark v110 chat anchors + add chat surface test
7c633e0d97 ui-parity(S4)        mark the four canonical v110 shell anchors + surface test
fddea89058 ui-parity(F0-b2)     wire v110 parity runners and npm scripts on new-ui
10176a5166 ui-parity(F0-b1)     expand v110 path classification to 100% coverage on new-ui
00d6ef7058 ui-parity(F0-a2)     ship JSON schemas for the v110 result/run/lock contracts
a7f03094de ui-parity(F0-a1)     ship JSON schemas for the v110 policy files on new-ui
cc5468217c ui-parity(V0-b)      rewrite home with v110 hero + composer + 6-pill row + surface test
75790ce8de ui-parity(V0-a)      add v110 home surface CSS to the shell contract
d578babdb4 ui-parity(PF0)       ship v110 parity baseline + policies on new-ui
```

41 commits, all atomic (one — F0-b1 — exceeds 400 LOC by design to keep the path-classification taxonomy coherent; the others stay under budget). Both locks (L0 + QF0) are land as lock-only files with PENDING-F0 markers for the hashes that F0 must compute.

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

## Verdict

`NOT_QUALIFIED`. The harness is missing. Open the next session on `_a7-automate-memory`, branch `new-ui` at `aad67a5800caab473b95b0509a0c4564ba52d56a`, and enchaîner le complément F0 (Docker + Playwright dans l'image) puis S0 census → S1 G1/G2 → S2 tokens pre-freeze → QF0 → S3 home full re-play → S4–S12 visual polish → S13 responsive/DLR/locales étendu → S14 motion → S15 full qualification. Le verdict final `NEW_UI_PARITY_QUALIFIED / READY_FOR_PROMOTION_DECISION` viendra à l'achèvement de S15.