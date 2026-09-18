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
aad67a5800 ui-parity(S14)        add v110 motion contract CSS + reduced-motion surface test
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

15 commits, all atomic (one — F0-b1 — exceeds 400 LOC by design to keep the path-classification taxonomy coherent; the others stay under budget).

## What is in place

### Visual port

- **V0 Home** rewritten to match the maquette v110-port-ready-r1 hero + composer + 6-pill row. Three pilot anchors wired: `data-parity="home.title"`, `home.modes-row`, `home.mode-pill`. Home CSS classes (`[data-v110="home*"]`) live in `packages/app/src/styles/v110.css`.
- **A4 Code chrome** (terminal card, head, resize handle, editor card, diff card, code-tabs strip) — CSS additions to v110.css aligned with the maquette's `#codeArea / .terminal-shell / .terminal-head / .tab / .terminal-resize-handle` selectors.
- **S14 Motion contract** — `--v110-split 680ms / --v110-micro 150ms / --v110-soft 220ms / --v110-easing cubic-bezier(.16,.84,.2,1)` tokens, kill-switches for `prefers-reduced-motion` and `html[data-ui-animations="off"]`, transition properties on the contract selectors.

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
- `packages/app/scripts/parity/` — 7 runners (`shared`, `environment-check`, `contract`, `path-classification-check`, `g0-mode-derive`, `checkpoint-lint`, `generated-verify`, `runtime`).
- `packages/app/package.json` — 15 `parity:*` npm scripts reachable.

## What is still missing

### G0 — qualified visual parity

The harness has not been built. The runners for `parity:census`, `parity:aa`, `parity:aa-prime`, `parity:visual`, `parity:motion`, `parity:mutations`, `parity:g3`, `parity:full` are explicit `PENDING_IMPL` stubs — they cannot be silently PASS, they wait for the Docker image + Playwright in image + A/A calibration + BrowserContext isolation + motion sampler + pixel engine + mutations to land.

### L0 — pilot lock

`pilot-contract-lock.json` is not written. The `pilotToolchainCommit` and `pilotContractLockHash` variables in `g0-derivation-policy.json` stay `null`. Until A/A calibration is recorded, no pilot lock.

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