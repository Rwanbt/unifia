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
