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
