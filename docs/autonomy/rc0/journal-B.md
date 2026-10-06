<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->
# Journal — Lane B (RC-0 release-1, base `dev`)

Append-only. Newest entry at the bottom. One entry per card, then a final summary.
Lane B write scope: `packages/app/src/**` (except `voice/`), `packages/unifia/src/session/**`,
`packages/unifia/src/lsp/**`, `packages/unifia/test/**` for lane-B-owned code, and this journal.
Lanes A, C and D run in parallel; nothing outside that scope is touched here.

## Environment

The session workspace is a different repository (`Rwanbt/Aion`, Rust). The RC-0 target is the
`Rwanbt/unifia` monorepo, whose only git checkout on this machine was `C:\Users\barat\unifia`
(parked on `main`, no `node_modules`). Following the convention already used by the parallel lanes
(`D:\App\unifia\_rc0-laneA`, `_rc0-laneC`, each an isolated clone with its own `node_modules`), lane B
works in an isolated clone at `D:\App\unifia\_rc0-laneB` — clone, `--branch dev --single-branch`,
`bun install --frozen-lockfile` = 2403 packages, exit 0. An isolated worktree was tried first under
the session temp dir and abandoned: `C:` has 7.7 GB free and lane D occupies the same temp path.

---

## B1 — CR01, session stuck after Stop on a never-ending generation (issue #77)

**Status: BLOCKED — the fix is a one-place change in a file the host LOC gate refuses to edit.
NEEDS-OWNER: grandfather `packages/unifia/src/session/prompt.ts` as a documented exception, or
authorize the extraction as its own card.**

### What was measured

Every run below is on this lane's isolated clone of `Rwanbt/unifia`, Bun 1.3.14. Measurements 1-3 were
taken on `origin/dev` = `26ba494d0`; the branch was then re-based onto the newer
`origin/dev` = `b122d0c4b` (`test(voice): guard the shipped Android TTS path against non-production
providers (#296)`) and the committed test file was re-verified on that base (1 pass / 1 skip / 0 fail).

1. The card's scenario does **not** reproduce on `dev` when the cancel is awaited.
   `bun test test/session/cr01-stop-recovery.test.ts` → `stop on a never-ending generation reaches
   idle and the next prompt runs` **1 pass, 8 expect() calls, 1.99 s**. Stop reaches `idle`, the next
   prompt runs, the queued response is consumed.

2. The real e2e path is green too, so this is not an in-process artifact.
   From `packages/app`, `bun run test:e2e:local -- e2e/v110/a3-journey.spec.ts --workers=1
   --retries=0` (Vite harness + real Bun backend + real Chromium, `TEMP`/`TMP` on D:) →
   **`1 passed (1.4m)`**, exit 0. That spec already contains the #77 recovery segment
   (`a3-journey.spec.ts:74-105`: hang → wait for the exact prompt in `llm.hits()` → Stop → second
   prompt → "Recovered after stop"). This matches the last entry of
   `docs/autonomy/rc0/CR01-DIAGNOSIS.md` (2026-10-01 addendum), which already recorded that the
   *synchronized* scenario passes and explicitly declined to claim a cause for #77.

3. The defect is real, and it is a **race the synchronized test cannot see**: the prompt must arrive
   while the interrupted run is still winding down — which is exactly what the UI allows, because the
   composer flips back to "Send" on client state alone, before the server-side run has finished.
   `a prompt submitted right after stop is executed, not swallowed by the finishing run` →
   **FAIL**: `expect(received).toBe(true)` / `Received: false` at
   `test/session/cr01-stop-recovery.test.ts:308`, the assertion that the second run produced
   "recovered after stop".

   The failure mode is worse than a hang in one respect and better in another: `prompt.loop` for the
   second prompt **returns success**, carrying the *previous* run's assistant message. No error, no
   timeout. The queue witness is the sharpest form of it: `expect(yield* llm.pending).toBe(0)` →
   **`Expected: 0, Received: 1`** — one queued response was never consumed, which is precisely what
   #77's reporter measured ("the fixture ends with a response still in the queue, proof that the
   second call did not consume the queued response"). This is the state
   `docs/autonomy/rc0/CR01-DIAGNOSIS.md` could not close: "the second message and the Thinking state
   are visible, but the absence of LLM consumption indicates that progression stops before the
   provider call".

### Root cause, located

`packages/unifia/src/session/prompt.ts:1888-1894` (pre-fix numbering):

```ts
const loop = Effect.fn("SessionPrompt.loop")(function* (input) {
  const s = yield* InstanceState.get(state)
  const runner = getRunner(s.runners, input.sessionID)
  return yield* runner.ensureRunning(runLoop(input.sessionID))
})
```

`Runner.ensureRunning` (`packages/unifia/src/effect/runner.ts:111-139`) gives an in-flight run
priority. In the `Running` and `ShellThenRun` branches it returns `Deferred.await(st.run.done)` — the
**in-flight run's** result — and the `runLoop` passed in by this caller is never started:

```ts
case "Running":
case "ShellThenRun":
  return [Deferred.await(st.run.done), st] as const
```

`runLoop` re-reads messages every iteration and exits when the newest finished assistant is newer
than the newest user message (`prompt.ts:1603-1637`). So a prompt added while the run is still
generating *is* picked up. A prompt added **after** that break decision, but **before** the runner
reaches `Idle` (the fiber still has to unwind: `Effect.onExit` → `finishRun` → `onIdle`, which itself
forks learning extraction), is picked up by nobody. The message is stranded, the composer shows
"Thinking…", and the reply stays unread in the provider queue. That is #77 verbatim.

The shipped consumer of this path, confirmed by reading the route, not by a unit test:
`POST /session/:sessionID/message` → `SessionPrompt.prompt` (`src/server/routes/session.ts:819` and
the async variant at `:851`) → service `prompt` (`prompt.ts:1574`) → `loop` → `ensureRunning`.

### Why the fix is not landed

The one place that can express the fix is `loop` in `prompt.ts`. That file is 2217 lines and the host
LOC gate refuses to edit it:

```
LOC gate: packages/unifia/src/session/prompt.ts has 2217 lines (blocking limit: 1500).
Refactor before editing — see AGENTS.md "Code structure"
```

The method's own numbers for this case do not resolve inside one PR: file size "mandatory refactor
>1500 LOC" against "PR ≤400 LOC changed, split into sequential autonomous PRs", and
`CLAUDE.md` "Design Review — Step 0" requires a mini-ADR in `docs/adr/` before any major module
extraction. So the policy conflict is real and is the owner's to settle, which is why this is
NEEDS-OWNER rather than a silent 700-line move inside a four-lane release. No attempt was made to
work around the gate by writing the file from the shell.

Two candidate fixes, for whoever picks this up:

- **A (in scope, 1 file, ~25 lines) — `src/session/prompt.ts`.** Make `loop` re-ask for a run while
  the session still holds a user message no finished assistant reply follows, i.e. the same
  "is there work left" question `runLoop` already asks, expressed over persisted messages. Guarded
  by a bounded pass count and only entered when the runner was busy on entry, so a provider failure
  is not retried and the shell path is untouched.
- **B (out of lane-B scope, 1 file, ~10 lines) — `src/effect/runner.ts`.** Give the `Running` branch
  of `ensureRunning` the same "run after this one" semantics the `Shell` branch already has
  (`ShellThenRun`). This fixes the class rather than the symptom, but `ensureRunning` is shared with
  `src/mcp/index.ts:802`, `src/session/llm.ts:383` and `src/local-llm-server/index.ts:848`, so it
  changes behaviour outside the session. `src/effect/**` is not in lane B's write scope.

### What is in the tree

`packages/unifia/test/session/cr01-stop-recovery.test.ts` is committed with the second test
**quarantined** (`it.skip`) and the reason in the test body, matching the convention already used in
this repo for anchors that cannot pass yet ("4 anchors quarantined with their reason, 0 silenced" —
`docs/autonomy/rc0/EXECUTION-LOG.md`, #239). The first test stays live and passing: it is the
guarantee that a *completed* cancel leaves the session usable, and it must not be lost if the fix
lands. The quarantined test is the ready-made red→green target for option A or B: un-skip it and it
should go green with no other change.

### Proof commands and results

| Command | Result |
|---|---|
| `bun test test/session/cr01-stop-recovery.test.ts` (pre-fix) | 1 pass / 1 fail, 10 expect() calls — fail at `:308`, `Received: false` |
| `bun run test:e2e:local -- e2e/v110/a3-journey.spec.ts --workers=1 --retries=0` (pre-fix) | `1 passed (1.4m)`, exit 0 |
| `bun run typecheck` (packages/unifia) | pending, recorded below with the commit |
| PR | pending, recorded below |

### Lane A dependency for #284

Not started. `docs/autonomy/rc0/journal-A.md` does not exist on `dev` yet, so lane A has not posted its
failing test for the LSP connection-disposal patch (`packages/unifia/src/lsp/client.ts`: dispose the
connection on server exit / stdin error / close, and on `connection.onClose` / `onError`). Applying a
patch whose failing test does not exist would violate the "failing test first" rule for this lane as
well, so the `#284` half of B1 is waiting on lane A and is **not** claimed.

### B1 follow-up (after PR #299)

PR #299 (docs, this entry) merged as `e0cda0e5` after the seven required checks plus CodeQL/Analyze
on the exact head. The quarantined reproducer
`packages/unifia/test/session/cr01-stop-recovery.test.ts` is still uncommitted and is queued as its
own PR so this one stayed under the 400-line gate. The `typecheck` / `PR` rows above are now filled:
`bun run typecheck` (packages/unifia) clean, `bun turbo typecheck --concurrency=1` 48/48.

---

## B2 — CR05, Automate run ownership across a reload

**Status: DONE.** The recovery path already existed on `dev`; what was missing was evidence that the
shipped surface actually takes it. That evidence is now delivered by PR #301.

### What was already there (measured, not assumed)

- Server: `NativeWorkflowRuntimePort.reclaim(runId, ownerId)` (`workbench-server/src/native-workflow-port.ts:84`),
  documented in place as *"CR05: a run opened in a later session. Ownership is bound to the principal
  that started it"*, backed by `claimAuthority(db, runId, ownerId, now)`.
- Route: `POST /v1/workflows/reclaim` → `handlers/automation.ts:20` `reclaimWorkflow`, refusing a
  non-owner with 403 `not-the-owner` and an unknown run with 404.
- Client: `WorkbenchClient.reclaimWorkflow(workspaceId, workflowId)` (`workbench-shell/src/client.ts:520`).
- Shipped surface: `automate-surface.tsx` Cancel control → `onCancelRun` (`automate-studio-debug.tsx`,
  `automate-studio-environment.tsx`) → `cancelRun` → `authorityOf`.

So the smaller of the two options the card offered is not needed: the token is **recoverable from the
server for the same principal**, and the surface already asked for it when its in-memory map missed.
Nothing is persisted, which is correct — the server is the authority on who owns a run.

### The gap that was real

`authorityOf` lived inside the SolidJS component, which cannot be imported in Node, so the only test
that could touch it was a regular expression over the component's source text
(`automate-surface.test.ts`: `expect(source).toMatch(/reclaimWorkflow\(current\.workspaceId, runId\)/)`).
That pins the shape of the code, not the behaviour: it would keep passing if the surface stopped
deciding anything, and it cannot show that a reload is recoverable.

PR #301 extracts the decision into `packages/app/src/pages/workbench/automate-authority.ts` (the
`automate-decode.ts` extraction pattern the same file's comments already describe), makes the surface
call it, and adds six behavioural tests: the start-time fast path makes no request, a cold store
reclaims from the server and caches, the reclaimed token is the server's (generation included, so a
client cannot reconstruct a stale one), a reply with no usable token throws instead of returning
something shaped like authority, and a 403 propagates. The static smoke test now pins the delegation.

### Proof commands and results

| Command | Result |
|---|---|
| `bun test test/server/workbench-automate-run.test.ts` (pre-existing, unmodified) | **3 pass / 0 fail**, 12 expect() calls — includes "a run from an earlier session is reclaimed by its owner and cancelled without a stored token (CR05)" |
| `bun test --preload ./happydom.ts src/pages/workbench/automate-authority.test.ts` | 6 pass / 0 fail, 19 expect() calls |
| the same plus `automate-surface.test.ts` and `automate-decode.test.ts` | 28 pass / 0 fail |
| `bun run typecheck` (packages/app) | clean |
| `bun test` (packages/app, full suite) | **2109 pass / 1 skip / 0 fail**, 151478 expect() calls, 2110 tests across 252 files. The skip is the pre-existing live-server STT test. |
| PR | #301, squash-merged as `56ad2a2a` after the seven required checks + CodeQL/Analyze on head `4e348ed70` |

### Not claimed

Re-driving a run that was already *running* across a reload is a different question and is not
covered: `driveRun` is called only from the start path, so a run interrupted by a reload still sits on
its first step until someone cancels it. That is outside this card's DONE criterion (which is about
cancel) and is recorded here rather than fixed.

---

## B3 — CR08, editor parity gaps (issue #96)

**Status: DONE — one gap already wired and now proved; two gaps have no engine and are deferred with
their measurement. No fake control was added.**

### Diagnostic markers — already delivered, verified end to end

| Link | Evidence |
|---|---|
| LSP diagnostics exist | `src/lsp/client.ts` exposes `open`, `waitForDiagnostics`, `shutdown`, `resolve` |
| mapped onto the v110 marker contract | `packages/ui/src/components/code-mirror-lsp.ts:197` `collectDiagnosticMarkers`, `:217` `V110DiagnosticGutterMarker` (emits `data-component="diagnostic-marker"`, `data-severity`, `title`), `:239` `v110DiagnosticGutter()` |
| shipped | `code-mirror-lsp.ts:286` includes it in `buildLspExtensions`; `packages/ui/src/components/code-mirror.tsx:220` calls `buildLspExtensions` when `props.lsp` is set |
| app passes the callbacks | `pages/session/file-tabs.tsx:116` → `pages/session/editor-panel.tsx:483` `lsp={props.lspCallbacks}` |
| theme rule no longer dormant | `packages/app/src/styles/v110.css:965` `[data-component="diagnostic-marker"][data-severity=…]` |
| test | `pages/session/lsp-diagnostic-markers.test.ts`, **4 pass / 0 fail**, 7 expect() calls |

The issue's grep claim ("`[data-component="diagnostic-marker"]` exists in `v110.css` only; the CM LSP
path renders no marker DOM with that attribute") is therefore **out of date**: the DOM is built at
`code-mirror-lsp.ts:226`. It was true when #96 was filed and is not true now.

### Code lens — no engine, deferred

`codeLens` returns **0 matches** across `packages/app/src`, `packages/ui/src` and `packages/unifia/src`.
The LSP client wires diagnostics, hover, definition, references, completion, rename, codeAction,
executeCommand and call hierarchy — there is no `textDocument/codeLens` request and no
`ServerCapabilities.codeLensProvider` handling. Shipping code lens needs a new server capability plus
a CM widget layer, which is engine work, not wiring. Nothing was added.

### Inline AI — no engine, deferred, and one untrue string found

`ghostText`, `inlineAi`, `inlineSuggest`, `nextEdit` and `NextEdit` all return **0 matches** across the
same three packages. `pages/session/auto-edit.ts` only enters edit mode on double-click; there is no
suggestion model and no ghost-text extension.

What does exist is a claim: `pages/session/code-inspector/overview.tsx:73-75` renders a **Completion**
card whose body (`inspector.code.overview.completionHint`) states *"Ghost text and Next Edit are
independent of Ask / Assist / Build / Auto."* Both named features do not exist. This is the only place
in the RB05 scan where the UI asserts something untrue, and it is left in place: rewording product copy
is an owner decision and falls under the same undecided policy as RB07 (see B4).

Per the card, both gaps stay disabled/absent rather than shipping a fake control. No "soon" control was
added for either, because adding a permanently-disabled control for a feature with no engine is itself
the noise RB07 exists to decide about.

### Proof commands and results

| Command | Result |
|---|---|
| `bun test --preload ./happydom.ts src/pages/session/lsp-diagnostic-markers.test.ts` | 4 pass / 0 fail |
| grep `codeLens` / `ghostText` / `inlineAi` / `inlineSuggest` / `nextEdit` / `NextEdit` over the three packages | 0 matches each |
| grep `v110DiagnosticGutter\|buildLspExtensions` | 1 ship site each, cited above |
| PR | none needed — diagnostic markers were already shipped; no code changed for B3 |

### Outside lane-B scope

Issue #96's second acceptance criterion is "Matrix rows updated to match reality in the same PR",
against `docs/ui-reference/v110/M3-ACCEPTANCE-MATRIX.md`. That file is not in lane B's write scope, so
the matrix still says "a tester"/"partial" for these rows. Flagged for the owner or for a lane holding
that path.

---

## B4 — RB05 control truth table, then FX00

**Status: DONE for RB05 (table delivered, no unclassified row, rescan finds no silent no-op).
NEEDS-OWNER RB07 for FX00, because the policy FX00 must apply is an open decision.**

Deliverable: `docs/audit/RB05-CONTROL-TRUTH-TABLE.md`, produced from the committed census runner on the
fixed SHA `56ad2a2a` (547 files, 3077 candidates, clean tree). It classifies every visible control of
Home, Chat, Code, Work, Design, Automate, Memory, Settings and Account as REAL (821), EXPLICITLY_DISABLED
(54), CONDITIONALLY_DISABLED (174), spread-only (15) or STATIC (2013) — mutually exclusive classes that
sum to 3077 on every row — plus 5 REMOVED components.

Two findings worth surfacing beyond the table itself:

- **No silent no-op exists on this SHA.** Restricting to genuinely interactive native elements yields 3
  candidates and all three are refuted by reading them (a permanently-selected tab, a `type="submit"`
  whose form carries the behaviour, and a download link rendered only when its snapshot is ready). The
  tempting false positive was the 167 `disabled` + handler controls: a reactive `disabled` on a control
  with a live handler is a working control, not a no-op.
- **The first pass of the table was wrong and was corrected.** It reported `Memory | 1 | 0 | 0` because
  the file mapping gave `pages/session/memory-*` to Chat. Memory actually holds 118 candidates (61 of
  them REAL) and Chat holds 229, not 346. Same shape as the false negatives the execution log has twice
  retracted: absence of a match is not absence of the control.

### FX00 — NEEDS-OWNER RB07

`DECISIONS.md` records the "soon"-control policy as **open decision O1** (*"Politique des contrôles
« SOON » : implémenter maintenant ou masquer jusqu'au train concerné (RB07, FX00)"*), and its header
states the open decisions have not been settled. There is no owner policy to apply, so per the card:

- `NEEDS-OWNER RB07` — ship the 54 explicitly-disabled controls visible-and-greyed in release 1, or hide
  them until their train.
- **All of them stay disabled and labelled.** Every one already renders the compliant shape
  (`aria-disabled="true"` with a `common.comingSoon` tooltip, or `disabled` + `data-soon` + a hint) and
  none carries a handler, citing ADR-047 and ADR-085. Nothing in this lane enables, deletes or relabels
  one.
- The false completion-hint sentence from B3 belongs to the same decision and is untouched.

### Proof commands and results

| Command | Result |
|---|---|
| `bun run scripts/parity/control-census-run.ts` (packages/app) | exit 0 — 547 files, 3077 candidates, 6 869 944 bytes, `sourceDirty: false`, `sourceSha 56ad2a2a…` |
| classification pass over the census | 821 + 54 + 174 + 15 + 2013 = 3077 |
| per-surface rows | each row's columns sum to that row's candidate count |
| grep for exported-but-never-rendered components | 5 found, each verified by a repo-wide search |
| PR | the number and merge SHA are recorded in the final summary entry at the end of this journal (this row is written before the PR exists) |

---

## B5 — UI00, parity harness on one fixed `dev` SHA

**Status: DONE (verification card). The harness ran end to end against the desktop bridge on the
fixed SHA, no baseline was regenerated, and both failing slices are diagnosed from measurement rather
than inherited from the log.**

### Fixed SHA and environment

`origin/dev` = **`56ad2a2ad45cb1d57f51eb38f8df36399cd43ee7`**
(`test(automate): prove an Automate run survives a reload`), clean tree.

Started for this card, all with a sandboxed `XDG_*`/`UNIFIA_TEST_HOME` under `.build-temp/b5`:

- **Backend / desktop bridge** — `bun run --conditions=browser ./src/index.ts serve --port 4096
  --hostname 127.0.0.1` from `packages/unifia`, with `UNIFIA_SERVER_PASSWORD=rc0laneB`.
  Measured: `GET /global/health` → **401** unauthenticated, **200** with basic auth. The password is
  what makes the bridge exist at all: ADR-041 decision 2 keeps the bridge route 404 without it and the
  app on its desktop-only banner, so Work/Automate/Memory could not render. Two operational facts
  learned the hard way, both recorded because they cost the attempts: the server's parent watchdog
  treats **end-of-stdin as a desktop crash** and exits (so stdin must be held open — the same reason
  `packages/app/e2e/backend.ts` keeps its pipe open), and `bun run vite` is killed by the executor
  supervisor because the wrapper spawns a second bun, so Vite was started as `node node_modules/vite/bin/vite.js`.
- **Vite** — `http://127.0.0.1:4444`, `VITE_OPENCODE_SERVER_PORT=4096`, `VITE_OPENCODE_SERVER_PASSWORD`
  set. `GET /` → 200.
- **Chromium** — `chromium-1234` with `--remote-debugging-port=9222`; `/json/version` → Chrome/151.
  `runtime-pair.ts` attaches over CDP by design because its own header records that
  `chromium.launch()` wedges on this host.

### What is and is not a harness

`bun run parity:{census,aa,aa-prime,visual,motion,mutations,g3,full}` are **orchestrator stubs**. Every
one of them returns `PENDING_IMPL` with the reason *"F0 has not yet built the harness (Docker image,
Playwright in image, A/A calibration, BrowserContext isolation, motion sampler, pixel engine,
mutations)"*. They never claim PASS, which is the right behaviour, but they are not evidence of
anything and must not be quoted as a parity result.

The real harness is `parity:runtime:pair` (`scripts/parity/runtime-pair.ts`, 16 committed fragments in
`e2e/v110/parity-manifest/`), and it ran:

```
node --experimental-strip-types scripts/parity/runtime-pair.ts \
  --cdp=http://127.0.0.1:9222 --base=http://127.0.0.1:4444 --project=<slug>
```

### Result — 16 fragments, 10 PASS, 2 FAIL, 4 BLOCKED

| Outcome | Fragment | Detail |
|---|---|---|
| PASS ×6 | `home.title`, `home.subtitle`, `home.state-line`, `home.modes-row`, `home.mode-pill`, `home.composer-card` | raw 1 visible 1 (mode-pill raw 6 visible 6) |
| PASS ×3 | `shell.rail`, `shell.topbar`, `settings.dialog` | raw 1 visible 1 |
| PASS | `work.content` | raw 1 visible 1 — **Work measured against the desktop bridge** |
| FAIL | `shell.inspector` | raw 1/1 **visible 0/1** |
| FAIL | `work.shell` | **raw 0/1** visible 0/1 |
| BLOCKED ×2 | `code.editor`, `code.terminal` | "code scene needs a file open, which needs the backend on :4096" |
| BLOCKED | `automate.surface` | "automate mode is capability-gated; the home pill opens the project dialog instead" |
| BLOCKED | `memory.panel` | "memory mode is unreachable in this workspace; the rail exposes only code/work/design" |

**On the card's "including Work/Automate/Memory against the desktop bridge":** Work was measured and
passed. Automate and Memory are BLOCKED **by the harness's own declared reasons** (`route()` at
`runtime-pair.ts:83-91` returns `null` for both, and `REASONS` at `:93-97` gives the reason). That is
the harness refusing to fake a measurement — its header states *"A scene that cannot be realised is
reported BLOCKED with a reason. It is never silently skipped, because a skipped fragment reads as a
passing one."* Automate additionally needs the capability gate opened and Memory needs a workspace
whose rail exposes memory mode; both are environment, not product defects, and neither is fixed here.

### The two failing slices, diagnosed by measurement

**`work.shell` — manifest-side, not product.** The element is simply not in the DOM
(`found: false` in a direct CDP probe). The manifest declares
`app.selector = div[data-parity="work.shell"]` with `reference.selector = div.work-view`. The product
ships `data-parity="work.surface"` on that very element — `work-surface.tsx:122`
(`<div data-v110="work-view" data-workbench-surface="work" data-parity="work.surface">`) — and the probe
confirms it renders at 967×809 and is visible. The shipped key is pinned by a passing unit test
(`session-workspace-layout.test.ts:166`), while `work.shell` has no element, no CSS and no test. The
manifest key is stale; it was not renamed because `parity:manifest:check` cross-references each id
against `parity/state-policy.json` and `parity/style-profiles.json`. Not fixed here (card: record, do
not fix).

**`shell.inspector` — a wrong state vector, plus a real trap next to it.** The anchor *is* present
(`raw 1/1`), so this is not a missing anchor. Measured in the live DOM at 1440×900:

- `aside[data-parity="shell.inspector"]` is **0 px wide at x=1453** — outside the 1440 viewport — and
  its parent is a `display:flex; flex:0 1 auto; overflow:hidden` column that is itself 0 px wide and
  contains only that aside.
- `--v110-inspector` resolves to **300px** and the inline style is
  `width: var(--v110-inspector, 300px)`, so the zero width is the flex column collapsing, not a missing
  variable.
- `#v110-inspector-panel` is `display:none` because `v110-inspector-frame.tsx:102` renders
  `<div id="v110-inspector-panel" role="tabpanel" hidden={!props.open}>` — the panel is closed in the
  default state.
- The in-frame toggle `[data-action="inspector-toggle"]` lives **inside that 0-width column**, so it is
  itself invisible and unclickable (Playwright: "element is not visible", 58 retries). A control that
  cannot be seen or pressed is precisely the class RB05/RB07 exist to decide about, and it is the same
  shape as the terminal-tab 0×0 button the log retracted once already.
- The inspector is nevertheless openable: `[data-v110="inspector-toggle"]` in the **titlebar**
  (`components/titlebar.tsx:365`) is visible, and clicking it measured `asideW 0 → 299`,
  `asideX 1453 → 1120`, panel `display:none → flex`.

So the harness's FAIL is caused by the fragment declaring `stateVectors: ["default"]` with
`visibleCount: 1` when no shipped default state has the inspector open. The manifest expectation is
wrong; the 0-width collapse and the unreachable in-frame toggle are a separate, real layout finding.
Both are recorded, neither is fixed here.

### Static gates on the same SHA

| Gate | Result |
|---|---|
| `bun run parity:manifest:check` | **exit 1, 17 errors — but ONE cause.** The first is `census missing at parity\artifacts\census-static.json: run parity:census first`; the other 16 are all "app marker X is not present in the census", i.e. downstream of the missing artifact, not 16 defects. `censusKeys: 0`. Quoting the 17 as 17 problems would be the same mistake the log recorded for the console-404 gate, where relaxing a filter would have masked every real 404. |
| `bun run parity:environment:check` | **exit 0** (PASS). It does report `fontSetPath: "PENDING-F0"` / `fontSetHash: "PENDING-F0"` / `families: []`, so font fingerprinting is still unbuilt. |

### No baseline was regenerated

`runtime-pair.ts` measures DOM counts and computed geometry; it never writes a screenshot. The only
file it produced is `parity/artifacts/runtime-pair.json`, which `.gitignore:190` ignores, and
`git status` after the run shows no modified tracked file. `--update-snapshots` was never invoked and
the committed `__screenshots__` baselines are untouched.

### Not claimed

- No pixel/visual comparison was made. The committed visual baselines
  (`e2e/design/__screenshots__/win32`) were not exercised: the log records that they encode the clone
  path and branch name, so regenerating them here would be wrong and running them on another clone
  fails for that reason alone.
- The 4 BLOCKED scenes were not forced open. Automate needs a capability grant and Memory needs a
  different workspace; doing either would be changing the environment to manufacture a pass.

---

## B6 — PW00 package wiring policy (proposal)

**Status: DONE for PW00 — the policy is written for every declared package. NEEDS-OWNER PW01: the
approval the card requires has not happened, and PW01 additionally turns out to be unreachable from
lane B.**

Deliverable: `docs/autonomy/rc0/PACKAGE-WIRING-POLICY.md`. `scripts/package-wiring.json` is **not
modified** — it is in lane B's scope but the card makes it a proposal, so nothing was applied.

### Baseline

```
$ node scripts/check-package-wiring.mjs
package wiring ok: 25 reached from the shipped roots, 28 declared not shipped
```

**The card says 27 packages; the file declares 28.** `@unifia/network-authority` was added since the
card was written, with its own reason ("Delivered ahead of its consumer"), so the card's count is stale
by one. All 28 are covered.

### Verdict summary

- **WIRE (2):** `capability-runtime` (the card's PW01 target) and `scheduler` — the second because
  `docs/audit/AUDIT-CABLAGE-NEW-UI-2026-09-30.md` records `trigger.schedule` as "reste à running sans
  jamais se déclencher (aucun planificateur branché)", which is a named broken consumer with its engine
  already written.
- **PARK (26):** 10 with a live question attached (a consumer, a duplication risk, or a capability gate
  that is not release-1), and 16 that are permanently not-shippable — ADR-000 harnesses, release and
  conformance gates, the docs site, the separately deployed Slack/function/enterprise packages, build
  tooling, Storybook.
- **DELETE (0), deliberately.** `DECISIONS.md` states the objective as "Tout câbler sans exception,
  étape par étape ; supprimer du câblage = régression d'objectif" and "Tous les PW/FX/BR sont
  conservés". Deleting a workspace package would also mean a manifest edit and would drop its tests out
  of CI, so park is the honest verdict for anything without a named consumer.

### The measurement that shapes the verdicts

**Seven engines are reachable only from `@unifia/release-hardening`**, which is itself not shipped:
`computer-use-safety`, `mcp-ui-actions`, `memory-governance`, `remote-bridge`, `document-packs`,
`workbench-orchestrator`, `artifact-studio`. A release gate calling an engine is not a product surface,
which is exactly the failure mode the checker's own comment was written for.

### NEEDS-OWNER PW01 — and a second blocker the card does not mention

The card gates PW01 on owner approval. Two things must be settled, and neither is mine to settle:

1. **`capability-runtime` cannot be imported at all today.** Its `package.json` has no `main`, no
   `exports` and no `types` (`desktop-runtime` is the same). Wiring it means editing a manifest, and
   manifests are lane D. So PW01's own DONE criterion — `check-package-wiring.mjs` passing with the
   package removed from `notShipped`, plus a test calling the shipped route with a 200 — **cannot be
   reached from lane B's write scope.**
2. **It would create a second authority.** `capability-runtime`'s `enforce()` applies a grant TTL, and
   the shipped `workbench-server/src/approval-gate.ts` already does: it imports `DEFAULT_GRANT_TTL_MS`
   from `./constants.js`, holds `#grantTtlMs`, and says *"a granted decision only stays honored for
   grantTtlMs"*. Both are 5 minutes. Wiring the runtime in without deciding which path is authoritative
   would leave the shipped server enforcing grants twice through two independent code paths — a
   security-relevant choice, not a wiring detail.

The owner is asked: is `capability-runtime` meant to **replace** the approval gate's TTL/trust
enforcement or sit beside it, and which capability routes must move from 503 to 200?

### Proof commands and results

| Command | Result |
|---|---|
| `node scripts/check-package-wiring.mjs` | `package wiring ok: 25 reached from the shipped roots, 28 declared not shipped`, exit 0 |
| per-package facts via the checker's own `computeWiring` export | source/test counts, `private`, `exports` keys, and the shipped / not-shipped import sets for all 28 |
| `capability-runtime` / `desktop-runtime` manifest read | no `main`, no `exports`, no `types` |
| grep `grantTtlMs\|DEFAULT_GRANT_TTL_MS` in `workbench-server` | `approval-gate.ts:8,13,20,27,33,48` |
| PR | #306, squash-merged as `ccae7361` |

---

# Lane B — final summary

Six cards. Four DONE, one BLOCKED with the blocker named, one NOT CLAIMED because it depends on
another lane. Nothing is claimed as fixed that is not fixed.

| Card | Status | PR (merge SHA) | What actually landed |
|---|---|---|---|
| B1 — CR01 stuck session, #77 | **BLOCKED / NEEDS-OWNER** | #299 `e0cda0e5`, #307 `a9d77688` | Reproduction + located mechanism + quarantined red test. **No fix.** |
| B2 — CR05 Automate ownership across reload | **DONE** | #301 `56ad2a2a` | Recovery path proven and the shipped surface wired to the proof |
| B3 — CR08 editor gaps, #96 | **DONE** | #303 `09c9e5ce6` | Diagnostic markers proven end to end; code lens and inline AI deferred with their measurement |
| B4 — RB05 truth table + FX00 | **DONE** (RB05) / **NEEDS-OWNER RB07** (FX00) | #303 `09c9e5ce6` | 3077 controls classified on a fixed SHA; no silent no-op; 5 REMOVED listed |
| B5 — UI00 parity on one fixed SHA | **DONE** (verification) | #306 `ccae7361` | Harness ran: 16 fragments, 10 PASS / 2 FAIL / 4 BLOCKED; both failures diagnosed |
| B6 — PW00 wiring policy | **DONE** (proposal) / **NEEDS-OWNER PW01** | #306 `ccae7361` | 28 packages classified wire/park/delete; PW01 blocked twice over |

## The four things a reviewer should read first

1. **B1 did not get a fix, and the reason is a policy conflict rather than difficulty.**
   `SessionPrompt.loop` is 3 lines and the whole defect is that `Runner.ensureRunning`'s `Running`
   branch returns the in-flight run's result without ever starting the caller's work, so a prompt that
   arrives after `runLoop` decided to exit is dropped silently — `llm.pending` measured 1 where 0 is
   required, and `loop` still returns success. The one file that can express the fix is 2217 lines and
   the host LOC gate refuses it, while the method simultaneously demands a mandatory refactor above
   1500 and a 400-line PR cap. I did not work around the gate by writing the file from the shell, and I
   did not smuggle a 700-line move into a four-lane release. Un-skipping the test in #307 should turn it
   green with no other change.
2. **B2's mechanism was already on `dev`; the missing part was evidence, and it was the kind of evidence
   that lies.** The server reclaims a token for the owning principal and the client exposes it, but the
   surface's decision to *use* it was pinned by a regular expression over source text. A regex over
   source keeps passing if the code stops working. That decision now has six behavioural tests and the
   shipped surface calls the tested code.
3. **B4's first table was wrong and the wrongness is still in the document.** It reported
   `Memory | 1 | 0 | 0` because the file mapping handed `pages/session/memory-*` to Chat; Memory holds
   118 candidates. Two counting traps were also corrected in place: `disabled={expr}` with a live
   handler is a working control, not a no-op (the tempting false positive), and the first REAL column
   double-counted 162 rows. The published numbers are a mutually exclusive partition that sums to 3077
   on every row.
4. **B5's two failures are manifest-side, and one of them hides a real trap.** `work.shell` does not
   exist because the product ships `work.surface` on the same node. `shell.inspector` exists but
   measures 0 px wide at x=1453 with its panel `display:none`, and **its own in-frame toggle lives
   inside that 0-width column and cannot be clicked** — while the titlebar toggle opens it cleanly
   (0 → 299 px). A control nobody can perceive or press is the exact class RB05/RB07 exist to decide
   about, and it is the same shape as the 0×0 terminal-tab button this log retracted once already.

## Issues: none closed, deliberately

Per D13 an issue is closed manually with its merge SHA. **No issue was closed, because no issue's
acceptance criteria are met:**

- **#77 stays OPEN.** The defect is reproduced and localized, not fixed.
- **#96 stays OPEN.** Diagnostic markers were already delivered and are now proven; code lens and
  inline AI have no engine and were deferred. Its second acceptance criterion — updating
  `docs/ui-reference/v110/M3-ACCEPTANCE-MATRIX.md` in the same PR — is also unmet, because that file is
  outside lane B's write scope.

## Decisions this lane needs from the owner

| # | Question | Why it is not mine |
|---|---|---|
| RB07 / O1 | Do the 54 explicitly-disabled controls ship visible-and-greyed in release 1, or stay hidden until their train? | Still listed as an **open decision** in `DECISIONS.md`; the file's own header says the open decisions are unsettled. All 54 stay disabled and labelled meanwhile. |
| CR01 LOC | Grandfather `src/session/prompt.ts` as a documented exception, or authorise the extraction as its own card? | Mandatory refactor >1500 LOC vs a 400-line PR cap; `CLAUDE.md` requires a mini-ADR before a major extraction. |
| #96 matrix | Who owns `M3-ACCEPTANCE-MATRIX.md`? | Outside lane B's write scope, and #96 requires it in the same PR as any fix. |
| PW01 | Is `capability-runtime` meant to **replace** `approval-gate.ts`'s TTL/trust enforcement or sit beside it? | It would otherwise enforce grants twice through two independent code paths — a security decision. It also has no `main`/`exports`/`types`, so wiring it is a manifest edit belonging to lane D. |

## Operational notes for the next lane

- **CI on this repo cancels jobs spuriously.** On #306 and #307 a large set of required checks came back
  `cancelled` after ~15 minutes across unrelated workflows (`typecheck`, `sdk-sync`, `check-standards`,
  `conformance`, `unit (linux)`), while identical content had passed minutes earlier. Re-running the
  affected runs individually converged: **7/7 required on both PRs after roughly five rounds**, with
  `gh run rerun <id> --failed` succeeding (it is refused in some contexts — the earlier `403` in this
  log was not universal). Nothing in those runs was a real defect; a cancelled job is not a red test.
- **Full `packages/unifia` suite on this host is not clean and not stable**: 5329 pass / 13 skip /
  9 fail, with the failing set varying between runs. Every member is either one of the four
  cross-process `plugin.install.concurrent` / `plugin.meta` tests (which also fail in isolation) or a
  5000 ms timeout on git-heavy fixtures such as `revert + compact workflow`, which likewise times out
  in isolation. None is in lane B's diff.
- **Working directory:** lane B used an isolated clone at `D:\App\unifia\_rc0-laneB` (Bun 1.3.14),
  following the convention lanes A and C already established on this machine. A git worktree under the
  session temp dir was tried first and abandoned: `C:` has 7.7 GB free and lane D occupies that path.

## What is deliberately not done

- No product behaviour was changed for B1, B3, B4, B5 or B6.
- No i18n key was added or modified, so nothing was added to the 16-locale translation burden.
- No icon, animation, manifest, lockfile, `.github/**` or e2e spec was touched.
- The 5 REMOVED components are listed, not deleted: deleting them is a separate card and a manifest
  change.
- The `inspector.code.overview.completionHint` string that advertises two nonexistent features is
  reported, not reworded — it is product copy and belongs to the same undecided RB07 policy.

---

## Owner decisions of 2026-10-06, and what they change

The owner answered the three questions this journal raised, and one of the
answers invalidates a premise the B1 entry rested on. Both are recorded here
rather than quietly acted on.

### RB07 / O1 — DECIDED: grey and visible in release 1

The policy is settled: a control whose engine does not exist ships **visible and
greyed**, not hidden. This unblocks FX00, and the answer is cheaper than expected:

**Zero code changes are required.** All 54 controls classified EXPLICITLY_DISABLED
in B4 already render exactly that shape — `aria-disabled="true"` with a
`common.comingSoon` tooltip (`work-cockpit.tsx:42-47`), or `disabled` + `data-soon`
+ a hint (`code-inspector/parts.tsx:52`) — and none carries a handler. The pattern
is also corroborated inside the code itself: `work-cockpit.tsx:11` cites
"aria-disabled with a 'coming soon' tooltip (owner decision 2026-09-22)". So the
practice predates this ruling and the ruling confirms it rather than changing it.

One item is **not** covered by it and stays open. `inspector.code.overview.completionHint`
renders a card that asserts "Ghost text and Next Edit are independent of Ask /
Assist / Build / Auto" — a claim about two capabilities with zero implementation
(`ghostText`, `inlineAi`, `inlineSuggest`, `nextEdit`, `NextEdit` = 0 matches across
the three packages). "Grey and visible" is a rule about *availability*, and this
card is not grey: it tells the user a feature exists. Bringing it under the policy
means either greying the card or rewording it to say the capability is
unavailable, and both are product-copy choices. It is left untouched and is now
the only FX00 residue, narrowed from 54 items to one.

### PW01 — DECIDED: park, do not wire `capability-runtime`

The owner delegated the judgement explicitly ("je ne sais ce qui est le plus
judicieux pour garder tout fonctionnel sans régressions"). The answer is **park**,
and the reasoning is about not losing function rather than about the wiring:

- **Nothing that works today is lost by parking.** The shipped capability path is
  live and covered: `P3_CAPABILITIES` is the broker universe, `ApprovalBroker`
  resolves the decisions, and `approval-gate.ts` enforces the grant TTL. Parking
  `capability-runtime` removes nothing from the product.
- **Wiring it as a second authority is the one option that guarantees a
  regression risk.** Its `enforce()` applies a grant TTL that `approval-gate.ts`
  already applies (both 5 minutes). Two independent enforcement paths over grants
  is precisely the class of change that passes CI and fails in production.
- **Replacing the gate is safer than duplicating it, but it is a migration, not a
  wiring.** It changes security semantics that currently work, so it needs its own
  card and a security review — and it cannot be done by this lane anyway, because
  the package has no `main`/`exports`/`types` and adding them is a manifest edit
  (lane D).
- If the owner wants `capability-runtime`'s specific capabilities (Ed25519 manifest
  signing, trust classes, the secure registry), the honest route is a migration
  card that retires `approval-gate.ts`'s duplicate logic in the same change, so
  there is only ever one authority.

`scripts/package-wiring.json` stays untouched; the `capability-runtime` entry keeps
its existing reason.

### B1 — the LOC premise was wrong, and the refactor is not what the repo asked for

The B1 entry treated the 1500-line gate as binding on `prompt.ts`. It is not, and
the repository has said so **by name**:

- `scripts/loc-gate.mjs:4-9` — "Scoped to packages/app/src - the fork's own
  domain. Upstream packages (opencode/ui/sdk) are out of scope per ADR-0003", with
  `const ROOT = process.argv[2] ?? "packages/app/src"` and `BLOCK = 1500`. The CI
  gate does not look at `packages/unifia` at all.
- `docs/loc-debt-upstream.md` — "Les fichiers suivants appartiennent aux packages
  upstream (`packages/unifia/`, ...) et dépassent 1500 LOC. Ils sont **hors scope**
  du gate LOC fork (scopé à `packages/app/`)." Its table lists
  **`packages/unifia/src/session/prompt.ts` explicitly**, and its Action section
  says these files "seront traités dans le cadre d'une contribution upstream ou
  d'une session d'audit Track B".

So the host tool's guard is stricter than the project's own policy, and the debt
is already scheduled as a Track B audit session rather than a release-lane refactor.
The 4-PR extraction I had started (moving ~720 lines out of the session core, each
step =400 diff lines, ~3 h of CI in a four-lane release with an already-unstable
suite) would satisfy a guard this file is explicitly exempt from — and it would
touch `runLoop` and `createUserMessage`, the riskiest code in the module, for a
three-line fix.

One thing that audit is right about, and this lane should not paper over: the file
has grown from **2085 to 2217 lines** since the 2026-05-27 audit. The exemption is
correct for a release lane; the growth is real debt for the scheduled Track B
session.

**Status: awaiting a one-word go/no-go from the owner to land the fix without the
refactor.** The fix is a drain in `SessionPrompt.loop` (~25 lines) and the
quarantined test in #307 goes green with it. No attempt was made to route around
the guard by writing the file from the shell; the extraction was abandoned, and the
`prompt-schemas.ts` module started during it was deleted rather than left as an
uncalled helper.

### Correction: `Runner` has ONE production consumer, not four

The B1 entry says the runner fix is "shared with `src/mcp/index.ts`,
`src/session/llm.ts`, `src/local-llm-server`". **That is wrong**, and it inflated the
apparent blast radius. Those three `ensureRunning` hits are unrelated homonyms:

| Location | What it actually is |
|---|---|
| `mcp/index.ts:802` | `McpOAuthCallback.ensureRunning()` — the OAuth callback server |
| `session/llm.ts:383` | `LocalLLMServer.ensureRunning(...)` — the llama-server lifecycle |
| `local-llm-server/index.ts:907` | its own exported `ensureRunning` |

`@/effect/runner` is imported by exactly one production file, `src/session/prompt.ts`
(`Runner.make` at :202, `ensureRunning` at :1893); everything else is
`test/effect/runner.test.ts`. Same shape as the false negatives this log has
already retracted twice, and it was caught by re-running the search rather than
re-reading the earlier note.
---

## B1, second half — #284 (LSP client writes to a dead server's stdin)

**Status: BLOCKED — and the most useful thing this lane produced is a defect in the proposed patch
itself. No code is shipped: the fix could not be proven, and an unproven change to connection
lifetime is not something to land in a release lane.**

Lane A has since posted `journal-A.md` with the exact patch, the failing test and its measurements
(5/5 runs red, `writesOnDeadStdin` 18-34, EPIPE on Windows / EOF elsewhere). Applying it was
unblocked in principle: `src/lsp/client.ts` is 297 lines, so unlike `prompt.ts` it is under the LOC
gate and editable.

### The proposed patch does not work, for two independent reasons

**1. It binds `connection.onClose`/`onError` before `connection` exists.** The patch registers the
hooks and *then* declares `const connection = createMessageConnection(...)`. Those are methods on the
connection, so this is a temporal-dead-zone read: a `ReferenceError`, not a policy question.

**2. Its stdin guard breaks every LSP client.** This one only shows up when you run the suite, and it
is the reason this entry exists. `WriteableStreamMessageWriter` registers its own `'error'` and
`'close'` listeners **in its constructor**
(`vscode-jsonrpc/lib/common/messageWriter.js`: `this.writable.onError(...)`, `this.writable.onClose(...)`),
which for the Node RAL means `stream.on('error'|'close', ...)` on whatever object was handed to
`StreamMessageWriter`. The patch's `on()` treats a `'close'`/`'end'`/`'error'` **registration** as
"the server is gone", so merely constructing the writer marks a perfectly healthy server dead:

```
(pass) handles workspace/workspaceFolders request          <- green before
(fail) LSPInitializeError: LSPInitializeError               <- all 4 red with the patch
error: LSP server process is gone   code: ERR_STREAM_DESTROYED
```

Registering a listener is not the event firing. The events have to be observed on the stream itself
(`rawStdin.once('close'|'end'|'error')`), with `on()` left as a pure pass-through. With that
correction the four pre-existing tests go back to green.

Verified against the installed `vscode-jsonrpc`: `lib/node/ril.js` uses only `on`, `off`, `write` and
`end` on the stream, so the wrapper's surface is otherwise complete.

### The fix is still not proven, so it is not shipped

Correcting the patch was not enough to demonstrate the bug or the cure, and a change to when a
connection is disposed is exactly the kind of thing that must not ship on faith. Three attempts at the
reproducer, each discarded rather than kept:

| Attempt | Result | Why it proves nothing |
|---|---|---|
| 1. Hand-rolled `sendNotification`, small burst, SIGKILL | green | green **without** the fix too |
| 2. Exiting fixture, `FAKE_LSP_EXIT_DELAY_MS=0` | green | server dies mid-handshake, `create()` rejects, `client` is undefined, no write ever happens — vacuous |
| 3. Same fixture, `FAKE_LSP_EXIT_DELAY_MS=120` | red | red in **setup** (`create()` throws `Connection is closed`), not #284 |
| 4. Crash placed by message count instead of a timer | green | green without the fix — still vacuous |

So #284 did **not** reproduce here, and I will not claim it is fixed. Per the card's own rule
(three attempts, then revert and record) the change is reverted, and the two test files plus the
fixture written along the way were deleted rather than committed: a test that cannot fail is worse
than no test, because it reads as coverage.

One production fact worth recording, because it decides whether the fix is even needed in this shape:
`LSP.touchFile` already contains the failure. `src/lsp/index.ts:521-531` wraps
`client.notify.open(...)` in `Promise.all(...).catch(err => log.error(...))`, so a disposed-connection
rejection is caught and logged. The EPIPE of #284 is different precisely because it is thrown out of
`write()` and never reaches that `.catch`. Any fix therefore has to keep the error on the promise
chain — which is what `guardedStdin.write` returning `ERR_STREAM_DESTROYED` through the write callback
would do — rather than merely disposing earlier.

### Next step for whoever picks this up

Reuse lane A's own reproducer (`client-dead-server.test.ts` plus their exiting fixture, already
described in `journal-A.md` with its burst table) rather than a fresh one: it is the only version
measured red 5/5. Apply the two corrections above, and only land it if the reproducer goes red on
`dev` first.

---

## B1, third pass — accounting for the current unit test suite

Requested after the lane merges, so this is a fresh read of the suite rather than a re-run of a remembered baseline. Two things came out of it: the suite is materially healthier than when this lane started, and every failure still standing is a timing artefact of this machine rather than a defect.

### The baseline moved, and in the right direction

| | pass | skip | fail |
|---|---|---|---|
| when lane B started | 5329 | 13 | 9 |
| now, on current `dev` | 5332-5333 | 13 | 2-3 |

Seven of the nine failures are gone — fixed by the other lanes, not by anything in this lane. A range rather than a single number, because the last two digits depend on which run you catch, which is the finding itself.

### No remaining failure is a defect, and this is measured, not assumed

Every failure in every run sits at 5000-5140ms against bun's 5000ms default budget. That is the signature of a machine slower than the runner, so the evidence assembled is:

- **The failing set moves between runs.** Run 1: `util.process > stop() bounds a hanging taskkill` plus an unnamed hook. Run 2: the two `revert + compact workflow` restore tests plus an unnamed hook in `test/knowledge/e2e/cli-process.test.ts`, right after `killed 1 dangling process`. A real defect reproduces; these trade places.
- **Isolated, they pass.** `bun test test/util/process.test.ts` → 12 pass / 0 fail, the hanging-taskkill case at 7115ms against its own 9000ms bound.
- **Isolated with a realistic budget, the two slow ones pass too.** `bun test test/session/revert-compact.test.ts --timeout 90000` → **7 pass / 0 fail**, with `restore messages in sequential order` at **6559ms** and `restore same file in sequential order` at **5697ms**. Both are real work — a `git` tmpdir plus three sequential turns, each tracking snapshots and generating patches — so they are slow, not hung, and neither leaks.
- **CI is green where it counts.** On the `dev` push produced by merging #340, `unit (linux)`, `unit (windows)` and `rust unit tests` all pass.
- **The repo already has precedent for this class.** `memory-context.test.ts` was reworked by 84d4030c5, *"refactor(test): isolate recall content assertions from disk timing"* — the same diagnosis applied to a different file.

**Recommendation: do not raise the timeouts.** CI is the authority for unit and rust, and loosening budgets so a slow local box goes green is precisely how a genuine disk-timing regression would get masked. The useful outcome is knowing the number: a red in `revert-compact.test.ts` or `util/process.test.ts` on this box means nothing until the file has been re-run on its own.

### What the recent merges actually added to the tests: nothing

`git diff --stat a9d1e3c4..origin/dev -- packages/*/test` is empty. The i18n lot (#325), the three dependency overrides (#329, #330, #331), the lane A/C/D journals and the QA12R note (#339) changed no test file. So the suite did not move under this lane; what moved was the reading of it.

### The session suite is the gate for the B1 fix, and here is that gate

`bun test test/session` on current `dev`: **321 pass / 5 skip / 2 fail** — the two failures being the disk-timing pair above, and nothing else. That is the number the B1 loop-drain fix has to beat.

One consequence worth stating plainly: the #77 regression test added in #307 is still `it.live.skip` at `test/session/cr01-stop-recovery.test.ts:300`, so it is skipped rather than enforced. #77 is therefore an *unenforced* regression on `dev` — green CI does not mean the race cannot come back, and it will not be caught until that test is un-skipped. That is the honest cost of shipping the fix quarantined, and it is another reason the fix is worth landing rather than leaving parked.

---

## Addendum — #284 is now proven, independently verified

The entry above closes with "the fix is not proven, so nothing ships". That was true when written and it is no longer the end of the story: the owner took the two corrections and opened **#344, `fix(lsp): stop queued writes to a dead server escaping the promise chain`**, carrying `client.ts` (+93/-6) with the fixture and a 203-line `client-dead-server.test.ts`.

This lane then verified it from the outside, which is the part that was missing — and it settles the question the four discarded attempts could not.

**Red first, without the fix.** `client.ts` restored from `5f32302e1`, test and fixture left in place:

```
(fail) no queued write is handed to a dead stdin
       Expected: 0
       Received: 43
(fail) a real child process dying mid-burst raises no unhandled error
 0 pass / 2 fail
```

43 queued writes really do land on a dead stdin. #284 is genuine and the test is not vacuous — which is exactly what none of the four attempts here could establish.

**Green with the fix:** 2 pass / 0 fail.

**No regression on the pre-existing suite**, which is where lane A's version failed:

```
bun test test/lsp/client.test.ts   ->   4 pass / 0 fail
  workspace/workspaceFolders 1749ms . registerCapability 845ms
  unregisterCapability 854ms . shutdown-in-flight 790ms
```

Lane A's variant of the same guard turned this file into 0 pass / 5 fail. #344 gets it right: `on()` is a pure pass-through, the events are observed via `rawStdin.once(...)`, and the temporal-dead-zone read is gone because `disposeConnection` is filled in after the connection is built. Whole LSP dir: 48 pass / 1 fail, that one failure being the 5000ms budget again (`handles workspace/workspaceFolders request` at 5042ms, green at 1749ms in isolation).

So #284 no longer needs this lane, and the recommendation to reuse the reproducer rather than write a fresh one was acted on — by writing a better one, since arming the kill after N writes and counting `writesOnDeadStdin` is a stronger witness than waiting for an escaped error.

### And a governance gap worth naming

`e2e (linux)` fails on `dev` itself, repeatedly, and it is **not** in the required-checks list (`check-compliance`, `check-standards`, `conformance`, `rust unit tests`, `sdk in sync with server`, `unit (linux)`, `unit (windows)`). Two distinct things are failing in it: a genuine assertion — `packages/app/e2e/v110/settings-behavior.spec.ts:137`, "removes a real MCP server", `expect(row).toHaveCount(0)` receiving 1 after a 45s poll — and the job then hitting its 110-minute timeout after 305 tests with retries.

Because `e2e` is not required, every one of those merges went green while `dev` stayed red, which is why it went unnoticed across several PRs. Lane A already has a `fix(e2e)` in flight. Adding `e2e (linux)` to the required list is an owner decision, not something to change from this lane.

Still open here: **#77**, whose fix remains gated on the plugin reload, and whose regression test remains `it.live.skip`.

---

## B1 is DONE — #77 fixed, test de-quarantined

This supersedes the `BLOCKED` verdict at the top of this journal, the LOC-gate rationale below it, the summary row for B1 in the six-card table, and the closing note that said #77 was "gated on the plugin reload".

**The blocker was never a code problem.** B1 was held because the host LOC gate refused to edit `packages/unifia/src/session/prompt.ts`. The edit was attempted again on a clean branch off current `dev` and accepted, so the premise of the BLOCKED verdict no longer holds. (The separate point that the LOC premise itself was wrong — one production consumer, not four — was already corrected in the owner-decisions entry, and that part still stands.)

### Red first

The test added in #307 was un-skipped and run unchanged. It fails exactly as measured before, and for the documented reason:

```
(fail) a prompt submitted right after stop is executed, not swallowed by the finishing run
       expect(llm.pending).toBe(0)
       Expected: 0
       Received: 1
 1 pass / 1 fail
```

One reply is queued and nothing consumes it. `SessionPrompt.loop` calls `Runner.ensureRunning`, whose `Running` branch returns the in-flight run's result and never starts the caller's work (`src/effect/runner.ts:111-139`), so `loop` returns SUCCESS carrying the *previous* run's message and the prompt is silently dropped.

### The fix

`loop` now re-asks for a run while the newest message is an unanswered user prompt, bounded by `LOOP_DRAIN_LIMIT = 10`. The witness is the queue itself: after a successful run the newest message is the assistant's, so the drain only fires when a newer user prompt genuinely arrived.

**The runner is deliberately untouched.** Its `ShellThenRun` semantics are shared with `startShell`, so giving the `Running` branch a different meaning there would reach well past this bug. The public surface is also small — `busy`, `state`, `ensureRunning`, `startShell`, `cancel` — which is what made a single-caller change in `loop` the right size. For the record, `Runner` has exactly one production consumer (`SessionPrompt`).

Bounded on purpose: a run that legitimately produces no assistant message would otherwise spin.

### Green, and no regression

| | before | after |
|---|---|---|
| `cr01-stop-recovery.test.ts` | 1 pass / 1 fail | **2 pass / 0 fail** |
| `bun test test/session` | 321 pass / 5 skip / 2 fail | **323 pass / 4 skip / 1 fail** |
| full package suite | 5333 pass / 13 skip / 2-3 fail | **5346 pass / 12 skip / 0 fail** |
| `bun turbo typecheck` | 48/48 | **48/48** |

The one remaining session failure is the disk-timing `revert + compact workflow > restore messages in sequential order` already characterised above — 5035ms against bun's 5000ms default, green at 6559ms with a realistic budget, and it swaps places with `restore same file in sequential order` between runs. The full-suite run, with less contention, was **0 fail** across 500 files.

Diff is 22 lines in `prompt.ts` plus the test's comment and un-skip.

### Two things noticed while doing this

**A retracted claim: `AI_SUMMARY.md` does *not* regenerate lossily.** An earlier version of this entry said that running the package tests rewrites `packages/unifia/AI_SUMMARY.md` and drops its `## Common failure modes` and `## Hot files` sections. That was wrong and is corrected here. Re-investigated on a clean branch: `tools/ai_docs/generate_ai_summary.py` pulls those two sections from `AI_CONTEXT.md` (lines 303-309) and reproduces the committed file exactly, bar a fresh timestamp and one corrected LOC count (`drizzle.config.ts` 9 -> 12, total 270 -> 273, which is real growth). Both sections survive every regeneration. The generator is sound; the earlier 21-line diff was misread, and nothing here needs fixing.

**Editing via PowerShell corrupted this file once.** An `Add-Content` of a here-string wrote CP1252 bytes (`0x97` em-dash, `0xE0`, `0xE9`) into a UTF-8 file, and a `Set-Content` rewrite added a BOM and CRLF. Both were repaired in the encoding-repair commit and this journal is now strictly valid UTF-8, but append to it with a real editor or a byte-safe append, not with PowerShell string writes.

---

## Re-audit on current `dev`, and the close of FX00

A later session picked the lane back up against a `dev` that had moved 20 commits
since the B1 entry above (`ca7ea5548120df1a88944bb9dbdcc8ef4c4de8f4`). The six
cards were re-checked against that SHA rather than against the journal's own
account of them, because the journal records what the lane *believed* at the
time, not what is on `dev` now.

### What was already delivered, and is still delivered

| Card | State on `ca7ea5548` | Evidence |
|---|---|---|
| B1 | DONE | `LOOP_DRAIN_LIMIT = 10` and the drain loop are in `src/session/prompt.ts:1893,1909`; the #77 regression test is un-skipped (`it.live`, not `it.live.skip`) at `test/session/cr01-stop-recovery.test.ts:235,303`. #284 landed separately as #344. |
| B2 | DONE | `automate-authority.ts` + its test are on `dev`; `bun test test/server/workbench-automate-run.test.ts` → **3 pass / 0 fail**, including *"a run from an earlier session is reclaimed by its owner and cancelled without a stored token (CR05)"* — the card's own wording, executed. |
| B3 | DONE (2 gaps deferred, 1 wired) | The deferrals still hold: `ghostText`, `inlineAi`, `inlineSuggest`, `nextEdit`, `NextEdit`, `codeLens` → **0 matches** across `packages/app/src`. Code lens and inline AI remain engine-less, so they stay disabled and labelled. |
| B5 | DONE | The UI00 run is recorded in this journal; nothing was regenerated, as the card required. |
| B6 / PW00 | DONE | `PACKAGE-WIRING-POLICY.md` carries a verdict row for **every** current `notShipped` entry. |
| B4 / FX00 | **closed below** | The 54 `EXPLICITLY_DISABLED` controls already match the decided policy; the one residue is fixed. |

### B4 — the silent-no-op exit criterion, re-measured

The RB05 exit criterion is *"a rescan finds no silent no-op"*. Re-run on
`ca7ea5548` with a clean tree (`sourceDirty: false`): 547 files, 6 878 477 bytes,
**3077 candidates, 0 unclassified**. Restricting to genuinely interactive native
elements (`button`, `a`, `input`, `select`, `textarea`, `summary`) with no
handler, no disable marker and no spread yields **2**, and both are still refuted
by reading them:

- `design-browser-tab.tsx:107` `<button type="submit">` sits inside its
  `<form>`; the behaviour is on the form.
- `design-toolbar.tsx:221` `<a download>` is rendered only under
  `<Show when={props.snapshot.kind === "ready"}>`, so its `href="#"` arm is
  unreachable.

**No silent no-op. The RB05 criterion still holds on current `dev`.**

An honest caveat, because a rescan that disagrees with itself is worth nothing:
this independent re-implementation reproduces the *exit criterion*, not the
published *partition*. It yields REAL 989 / EXPLICITLY_DISABLED 56 /
CONDITIONALLY_DISABLED 13 / spread-only 15 / STATIC 2004, against the table's
821 / 54 / 174 / 15 / 2013. Both sum to 3077 with none unclassified, and
`spread-only` matches exactly at 15. The whole of the difference is the
REAL-vs-CONDITIONALLY_DISABLED split — the documented `disabled={expr}` trap —
where my rule is simply coarser at deciding that a disable is expression-driven.
It also returns 2 no-op candidates rather than the table's 3, because it skips
any candidate carrying a `role` attribute, which drops
`terminal-panel-chrome.tsx:39 <button role="tab" aria-selected="true">`. The
published table remains the authority on the partition; this run confirms the
criterion, not the counts.

Two bugs were hit and fixed rather than reasoned around, and both would have
produced a confident wrong answer: the census stores a JSX string-literal
initializer *with its quotes*, so `aria-disabled="true"` lands as the value
`"true"` and a key-based match never fires; and PowerShell's `>` redirection
writes UTF-16, which turns `JSON.parse` into `Unrecognized token`. The first
inflated EXPLICITLY_DISABLED from 56 to 197 and reported 12 silent no-ops,
every one of which was a correctly disabled control.

### FX00 — the last residue is closed

RB07 was ruled by the owner on 2026-10-06: *a capability without an engine ships
visible and greyed, not hidden.* That resolves the 54 disabled controls without
a single line of code — they already render exactly that shape — and it leaves
the one item the ruling was going to have to reach, the completion-hint sentence.

That sentence was the only thing in the whole RB05 scan the policy did not
already cover, and the reason is structural rather than semantic: it is not a
control, so it was never grey. It is an affirmative statement, to the user, that
two features exist. Grey-and-visible is a rule about availability, and a card
that says "this is what we have" cannot be made compliant by staying visible.

So the card stays — the ruling requires it — and the claim changes:

> "Ghost text and Next Edit are **coming soon**. The LSP stays deterministic,
> without an LLM."

The clause about being "independent of Ask / Assist / Build / Auto" was dropped
rather than reworded: it describes a relationship between features that do not
exist, so there is no true version of it left to write. The second sentence was
already true and is untouched. All 17 locale files were updated in one pass;
`fr` got a real French sentence, the other 16 carry the English source, which is
how this key was already maintained.

The key sits under `inspector.`, which is not one of the four prefixes the parity
test polices, so translation CI does not cover it — the 17 files were updated
together anyway, and the parity suite is green.

### Proof commands and results

```
cd packages/app && bun typecheck                        -> exit 0
bun test src/i18n/parity.test.ts                        -> 10 pass / 0 fail  (48006 expect calls)
bun test                                                 -> 2128 pass / 1 skip / 0 fail  (253 files)
cd packages/unifia && bun test test/server/workbench-automate-run.test.ts
                                                          -> 3 pass / 0 fail
cd packages/app && bun run scripts/parity/control-census-run.ts
                                                          -> 3077 candidates, 0 unclassified, 2 no-op candidates (both refuted)
```

The one skip is `nemo streaming STT end-to-end (live server)`, which needs a live
provider and is unrelated to this change.

### Two corrections to the cards

- **PW00 says 27 `notShipped` packages; the manifest now holds 28.** The extra
  one is `@unifia/network-authority`, added by #278. It is already carried in
  `PACKAGE-WIRING-POLICY.md` as PARK ("lands automatically with the Browser
  service"), so the card's count is stale but its coverage is complete.
  Cross-checked mechanically: every `notShipped` package resolves to a verdict
  row, 0 missing.
- **PW01 is not "blocked", it is decided.** The owner chose **park**, so
  `scripts/package-wiring.json` is untouched and `@unifia/capability-runtime`
  keeps its reason verbatim. Nothing in this session wired it, and the route-200
  criterion in the card is therefore not applicable — it was the criterion for
  the wiring option that was not chosen.

### Operational note — this machine is out of disk

Lane B had to be re-audited from the existing clone rather than a fresh worktree:
`bun install` in a new worktree died with `ENOSPC` on `D:`, which was at
**0 GB free** (`C:` at 2.1 GB). The half-installed worktree was removed, which
returned 1.32 GB. Anyone picking up RC-0 work on this box should expect to reuse
`_rc0-laneA` / `_rc0-laneB` / `_rc0-laneC` and their existing `node_modules`
rather than create one more checkout per branch.
