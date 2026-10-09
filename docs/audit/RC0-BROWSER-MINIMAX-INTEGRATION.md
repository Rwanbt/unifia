<!-- SPDX-License-Identifier: MIT -->
# RC-0 — integrating the MiniMax Browser runtime branch (issue #118)

Date: 2026-10-05. Author of the source branch: MiniMax worker `MM2-B02-WORKER` (75 commits, 2026-09-28, local branch `feat/browser-navigation-v110`, never pushed). Integrator: Claude.

## What the branch was

`feat/browser-navigation-v110` forked from `new-ui` at `b08bbd1338`. It implements the #118 plan: a session-owned Browser service (`@unifia/browser-runtime`) on isolated Playwright contexts, a Network Authority package (`@unifia/network-authority`) that resolves, validates and pins egress, Workbench routes and client methods, agent tools (`browser_navigate/observe/act/control`), an encrypted session snapshot store, and a new Browser surface. That surface replaced the native Tauri WebView window `dev` had. Diff against `dev`: 116 files, +6 239/−370.

The worker kept an honest decision journal in `state.md`, with the residual risk of each decision. That journal is not committed at the repository root, because `dev` already tracks a `state.md` for the voice agent. It is summarised here instead.

## Merge onto dev — nine conflicts, resolved for dev's later decisions

| File | Resolution |
|---|---|
| `contracts/src/browser.ts` | dev's ADR-1035 sandbox (`allow-scripts` only) kept; the branch's wider token list and `allowTopNavigation`/`allowSameOrigin` dropped (no consumer). |
| `workbench-server/src/constants.ts` | Step-up set is the union: `artifact.*`, `workflow.run` (dev D1), `browser.download`, `browser.upload`. |
| `workbench-server/src/bootstrap.ts`, `unifia/src/server/workbench.ts` | Both `workflow` and `browserSessions` wired; dev's scrypt `deriveWorkbenchSigningKey` kept over the branch's bare sha256. |
| `unifia/src/session/prompt.ts` | Both imports (command-template from dev, BrowserToolContext from the branch). |
| `mode-inspector-content.tsx`, `design-browser-tab.tsx`, `browser-surface.tsx`, layout test | Branch architecture kept (runtime session, Design hands off to Browser). dev's two later additions (per-mode inspector publication, visited-pages side panel) re-applied on top of it, instead of the branch's provider signal. |

## Defects found and fixed during integration

1. **`BrowserSurface` was one ~350-line function** with twelve signals and English literals. It is split into `browser-session-resolve.ts` (pure, tested), `browser-session-controller.ts` (one `createStore`, tested) and five view components. Labels are translated (`browser.surface.*`, `browser.activity.*`, `inspector.browser.*`).
2. **`browser_control` let the model hand control back to itself** right after a user takeover, which voided #118's takeover criterion. Reclaiming AI control now goes through the same approval as a cross-origin move. Tested, including a refused approval leaving the user in control.
3. **Quarantine containment was Windows-only.** The driver compared against `root + "\\"`, so every download was refused on Linux and macOS. It now uses the shared `quarantine-path` helper.
4. **Browser handlers were placed in `handlers/automation.ts`.** They were moved to `handlers/browser-session.ts`, and `automation.ts` is identical to dev's.
5. **The `connected-surfaces` test imported `../../browser-runtime/src/...`** across packages (#54). It is now a declared dev dependency.
6. **Missing SPDX headers** on 12 files. Added.

## Blocker found by running it end to end (#279)

Every runtime e2e on the branch runs under **Node**. The server and the shipped sidecar run under **Bun**. Measured on Windows 11 with Bun 1.3.14 and Playwright 1.57.0:

- `chromium.launch()` never settles under Bun; it takes 71 ms under Node.
- `connectOverCDP(ws)` to a Chromium that is already running also never settles under Bun.
- Bun's native `WebSocket` gets an immediate `Browser.getVersion` reply from the same Chromium.

In the web harness, the session is created (201), the tab request never answers, and the surface stays on "Starting isolated Browser…". Options and acceptance criteria are in #279. The choice between a Node browser host, a CDP client on Bun's native WebSocket, or a Bun version pin is the owner's.

## Delivery plan — slices of ≤ ~400 lines, bottom-up

| Slice | Branch | State |
|---|---|---|
| contracts + ADR-087 | `agent/browser-b1-contracts` | merged #277 |
| network-authority (justified 724: new package, half tests) | `agent/browser-b2-network-authority` | merged #278 |
| runtime policies + quarantine fix | `agent/browser-b3a-runtime-policy` | #281 |
| download quarantine store | `agent/browser-b3b-runtime-downloads` | pushed, PR after #281 |
| session service (1 190: one service + tests) | `agent/browser-b3c-runtime-session` | pushed |
| Playwright pages (1 104: adapter + Chromium e2e) | `agent/browser-b3d-runtime-playwright` | pushed |
| shell routes + client | `agent/browser-b4a-workbench-shell` | #280 |
| server routes | `agent/browser-b4b-workbench-server` | pushed |
| scoped Browser lease (app/desktop/mobile) | `agent/browser-b6-app-scoped-lease` | pushed |
| session resolve, coordinates, execution log | `agent/browser-b8-app-surface` | pushed |
| session controller | `agent/browser-b9-app-controller` | pushed |
| i18n additions | `agent/browser-b10-app-i18n` | pushed |
| **unifia wiring + tools** | `agent/browser-b5-unifia-wiring` | **held on #279** |
| **chat dispatch through Workbench** | `agent/browser-b7-app-routing` | **held on #279** |
| **UI switch + native window removal** | `agent/browser-b11-app-switch` | **held on #279** |

The held slices are the ones that change behaviour. Merging them today would replace a working native Browser with one that never loads. The full integration, with every slice combined, lives on the local branch `integration/browser-on-dev` (`.worktrees/browser`).

## Verification of the combined integration

`bun turbo typecheck --concurrency=1` 48/48. Tests: app 2 130, contracts 743, browser-runtime 51, network-authority 16, workbench-shell 113, workbench-server green (bun + vitest), unifia browser/server/session subsets green. The only local failures also fail on pure `dev`: registry tests reading the parent checkout's `.opencode/tool`, Windows shell timeouts in `prompt-effect`, and a git-routes hook timeout. Browser-runtime Chromium e2e (Node): driver 4/4, takeover, and recovery with workspace isolation all pass. `cargo check` of the desktop after removing the native window passes with no warnings.

## Product limits to decide (not defects)

- Downloads are released only after a **clean** malware scan. Without `UNIFIA_CLAMSCAN_PATH` the verdict is `unavailable`, so nothing can be released, which is the case on most Windows machines.
- Quarantine metadata lives in memory, so files stay orphaned in quarantine after a restart.
- Released files land in `~/Downloads/Unifia/<sha256(workspace)>/downloads/`.
- The snapshot key is derived with HKDF from the server password. That is sound for the desktop's random password but does not stretch a human-chosen one.
- Android uses the same Playwright path and has never been qualified on a device.
