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
