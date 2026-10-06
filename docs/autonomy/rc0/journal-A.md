<!-- SPDX-License-Identifier: MIT -->
# journal-A â€” Lane A, RC-0 release-1 push (part 2 of 2)

**Scope:** `packages/app/e2e/**`, `packages/unifia/test/**`, `scripts/**`.
**Base:** `origin/dev`. **Worktree:** `D:\App\unifia\_rc0-laneA`.
**Cards:** A2 (QA02, #56 #57 #284).  Cards A1, A3 and A4 are in journal-A3A4.md.

`EXECUTION-LOG.md` is never edited from this lane. Anything outside the scope above is recorded as
`NEEDS-OWNER` with the exact patch. Every claim below is an executed measurement; where something could not be
reproduced, that is said rather than papered over.

| Card | Status | PR |
|---|---|---|
| A2 unit suite | DONE | #310 â†’ `939441437c` |
| A2 #284 | NEEDS-OWNER (lane B) | â€” |
| A2 #56 (a) FakeConnector | DONE | in #310 |
| A2 #56 (b) BrowserOpenFailed | NEEDS-OWNER (lane B) | â€” |
| A2 #57 | hardened, **not claimed fixed** | in #310 |

---

## A2 / #284 â€” LSP client writes to a dead server's stdin

**NEEDS-OWNER for lane B.** The fix is `packages/unifia/src/lsp/client.ts`, outside this lane's scope.

### What the measurements changed

The issue calls the cause an unproven hypothesis. It is proven, and it sits one level below where the issue put
it. Six disposable probes against the real `createMessageConnection` path â€” all created, executed and deleted,
none in any diff:

| # | Question | Measured answer |
|---|---|---|
| 1 | does a write queued when the server dies reach the destroyed pipe? | yes â€” `ril.js:88` via `messageWriter.js:99`, the exact frames in #284 |
| 2 | which error, Windows/Bun? | `EPIPE: broken pipe, write` errno **-32**, and `EOF: end of file, write` errno **-136** |
| 3 | does the write callback see it, so our `.catch()` could? | **no.** It is thrown out of `stream.write()` itself |
| 4 | does the connection notice first? | not always. With writes queued *before* the exit they still landed after destruction in **7 runs of 7** â€” `dispose()` and the connection's own close do **not** cancel entries already on vscode-jsonrpc's `writeSemaphore` |
| 5 | is `stdin.destroyed` a usable guard? | **no.** Still `false` in both shapes that break CI. The process, not the stream object, is reliably known to be gone |
| 6 | is a post-`exit` write still possible? | **no.** 5/5 runs refused with `Connection is closed.` The defect is exclusively the **queued drain** |

Stack captured from the real pipe, matching the issue frame for frame:

```
EPIPE: broken pipe, write   syscall: "write"  errno: -32  code: "EPIPE"
  at writeFast (internal:fs/streams:345:38)
  at <test proxy>                                   <- the write that was still queued
  at vscode-jsonrpc/lib/node/ril.js:88:29
  at write (vscode-jsonrpc/lib/node/ril.js:78:16)
  at doWrite (vscode-jsonrpc/lib/common/messageWriter.js:99:33)
```

The two existing mitigations do not cover it for concrete reasons, not inferred ones: `FORK (LSP-SAVE-LATENCY)`
disposes only when `initialize` **fails** â€” here it succeeded; `FORK (LSP-TEST-SUITE-REGRESSION)` guards only
writes racing **our** `shutdown()` â€” nobody called it.

### A dead guard in the shared test harness

`packages/unifia/test/preload.ts:12-20` installs a guard meant to absorb exactly this error in the suite. It
does not work, for two measured reasons: Bun 1.3.14 never delivers these to a `globalThis`
`unhandledrejection` listener â€” a listener registered exactly as `preload.ts:12` registers it received **zero**
events across every probe â€” and the error Bun actually raises carries `code: "EPIPE"` or `code: "EOF"`, neither
of which its `uncaughtException` branch matches, so it re-throws. It is dead code on the platform it was written
for. **Left in place on purpose**: removing a shared harness guard is not a lane-A decision. But anyone who
assumes it protects the suite should know it does not.

### The failing test

Two new files, in scope:

- `packages/unifia/test/fixture/lsp/fake-lsp-server-exits-after-initialize.js` â€” answers `initialize`, then
  **exits on its own**: no shutdown request, no `exit` notification, no stderr. `FAKE_LSP_EXIT_DELAY_MS` places
  the crash.
- `packages/unifia/test/lsp/client-dead-server.test.ts` â€” (1) the scenario over a transport the test owns, so
  the crash lands on a chosen write and the evidence is a number; (2) the same scenario over a real child
  process and a real pipe, where reaching the assertion at all *is* the assertion.

Queued writes are `notify.open()` â€” what a file save fires â€” not a hand-rolled `sendNotification`. Burst size is
quoted in bytes because that is what decides the outcome (writes onto a dead stdin, 2 runs per configuration):

```
 32 x  64 KiB ->  0      32 x 256 KiB ->  0      64 x  64 KiB ->  0     128 x  64 KiB ->  0
 64 x 256 KiB -> 24,32  128 x 128 KiB ->  8,12   128 x 256 KiB -> 75,78,79,79,81,130,130
```

32 MiB in flight never returned zero. Executed proof, 5 consecutive runs on the current `dev` client:

```
run 1 : pass=0 fail=2 realPipeError=EOF  writesOnDeadStdin=32
run 2 : pass=0 fail=2 realPipeError=EOF  writesOnDeadStdin=18
run 3 : pass=0 fail=2 realPipeError=EOF  writesOnDeadStdin=34
run 4 : pass=0 fail=2 realPipeError=EOF  writesOnDeadStdin=18
run 5 : pass=0 fail=2 realPipeError=EPIPE writesOnDeadStdin=28
```

5/5 failing, no run green, none passing for the wrong reason. Test 1's crash trigger moved from "burst nearly
drained" to "8 writes in flight" after an earlier revision passed 1 run in 5 by draining first.
`bun test test/lsp/client.test.ts` on the untouched tree: 4 pass / 0 fail, so the new file is the only failure
introduced and it is the intended one.

**Why no PR from lane A.** Both tests fail until `client.ts` is fixed; a PR with a red `unit (windows)` blocks
the required checks. The test is reproduced in full below so lane B can land the test and the fix together.

### NEEDS-OWNER â€” exact patch for lane B, `packages/unifia/src/lsp/client.ts`

Two edits. No timeout raised, no blanket `unhandledRejection` swallow. In `create()`, replace the two lines that
build the connection:

```ts
// FORK (LSP-DEAD-SERVER): a server can exit on its own while writes are still
// queued behind vscode-jsonrpc's writer semaphore. Neither dispose() nor the
// connection's own close cancels those queued entries, so each one still
// reaches doWrite() -> writable.write() -> ril.js stream.write() on a pipe
// that is already gone. The error does NOT come back through the write
// callback, so no promise in our chain can see it: measured EPIPE (errno -32)
// on Windows and EOF (errno -136) elsewhere, thrown out of write() itself at
// vscode-jsonrpc/lib/node/ril.js:88 via lib/common/messageWriter.js:99. That
// is what fails unit (windows) with 0 failing tests. See #284.
//
// `serverGone` is the only signal reliably set at that moment: stdin.destroyed
// is still false in the two shapes that break CI (measured), and the
// connection's close is processed only after the writes went out.
let serverGone = false
const markServerGone = () => {
  if (serverGone) return
  serverGone = true
  shuttingDown = true
  try {
    connection.dispose()
  } catch {}
}

const rawStdin = input.server.process.stdin as any
const guardedStdin = {
  on(event: string, listener: (...args: any[]) => void) {
    // A broken pipe reaches us as close/end before destroyed is ever set.
    if (event === "close" || event === "end" || event === "error") markServerGone()
    return rawStdin.on(event, listener)
  },
  write(data: string | Buffer, encoding?: any, cb?: any) {
    const done = typeof encoding === "function" ? encoding : typeof cb === "function" ? cb : undefined
    if (serverGone || rawStdin.destroyed) {
      const err = Object.assign(new Error("LSP server process is gone"), { code: "ERR_STREAM_DESTROYED" })
      if (done) setTimeout(() => done(err), 0)
      return false
    }
    return rawStdin.write(data, encoding, cb)
  },
  end() {
    if (serverGone || rawStdin.destroyed) return
    return rawStdin.end()
  },
}

input.server.process.once?.("exit", markServerGone)
input.server.process.once?.("close", markServerGone)
rawStdin.once?.("error", markServerGone)
connection.onClose(markServerGone)
connection.onError(markServerGone)

const connection = createMessageConnection(
  new StreamMessageReader(input.server.process.stdout as any),
  new StreamMessageWriter(guardedStdin as any),
)
```

`shuttingDown` is declared further down in `create()`; hoist it above this block, which is smaller than having
`markServerGone` not set it, and keeps a dead server indistinguishable from a shutting-down one for
`notify.open()` â€” that is what stops *new* writes at the source. `result.shutdown()` needs no change.

**Acceptance, unchanged from #284:** the new test passes and `unit (windows)` reports no unhandled error between
tests across three consecutive runs.

---

## A2 / #56 (a) â€” FakeConnector determinism: PROVEN, fixed in the test

**DONE** (test fix, in scope).

The issue suggests injecting a clock. Not possible in scope â€” `FakeConnector` takes no clock
(`src/model-intelligence/connectors/registry.ts`; options are only `mode` / `deterministic` / `fetchedAtUTC`).
The test is fixed instead, by asserting the property it was actually pinning.

**Root cause.** `fake.test.ts:95` compared two `discover()` calls expecting equal `fetchedAtUTC`, on the
reasoning that both land in the same wall-clock second because `isoUtcNow()` truncates. It truncates, it does
not freeze â€” `new Date().toISOString().replace(/\.\d{3}Z$/, "Z")` (`src/model-intelligence/schema.ts`). Any
pause crosses the boundary.

**Proof, executed.** A disposable test aligned the first call to the last millisecond of a second and took two
calls, 25 pairs, three times; two runs disagreed:

```
PROOF disagree=1/25 samples=["2026-10-05T16:40:49Z vs 2026-10-05T16:40:50Z"]
PROOF disagree=0/25 samples=[]
PROOF disagree=1/25 samples=["2026-10-05T16:42:48Z vs 2026-10-05T16:42:49Z"]
```

Unaligned the probability is roughly the inter-call gap over 1000 ms â€” small on an idle machine, not small on a
loaded runner, which is the profile #56 describes. The probe is in no diff.

**Fix.** The truncation is asserted directly: each `fetchedAtUTC` must match
`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` and `new Date(iso).getUTCMilliseconds()` must be `0`. Boundary-
independent, and still fails if milliseconds return. The original equality check is kept as a *consequence* â€”
when the two calls do share a second they must still match â€” so nothing was weakened.

**Executed proof:** `bun test test/model-intelligence/connectors/fake.test.ts` â€” 5 consecutive runs,
`20 pass / 0 fail`.

---

## A2 / #56 (b) â€” BrowserOpenFailed 180 s hang: NOT REPRODUCIBLE, NEEDS-OWNER for lane B

The test file is unchanged and reverting it is deliberate.

**Measurement first:** `bun test test/mcp/oauth-browser.test.ts` â€” 5 consecutive runs, `3 pass / 0 fail`. The
180 s timeout was not reproduced locally.

**The cause is not the test's timing.** `src/mcp/index.ts:850` creates the OAuth callback promise eagerly:

```ts
const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)
```

and does not always await it â€” when `open()` fails the Effect short-circuits and the promise is left dangling.
`McpOAuthCallback.stop()` then rejects **every** entry in `pendingAuths`
(`src/mcp/oauth-callback.ts:204-207`, `pending.reject(new Error("OAuth callback server stopped"))`) with nothing
listening, so the rejection escapes and is blamed on whichever test is running. That is an unhandled rejection
in product code.

**Reproduced deliberately.** Replacing the fixed `setTimeout(2_000)` with a condition wait on `open()` having
been called â€” so `stop()` ran ~120 ms in instead of 2 s â€” made the file's other two tests fail every run with
exactly that error and nothing else. So the 2 s sleep was not slack; it was masking this rejection by letting
the flow finish first. Two further measurements constrain any fix: `authPromise` does **not** settle on its own
within 15 s (bounded wait, 5/5 runs expired), so `stop()` is what unblocks it and the ordering is required; and
Bun delivers the rejection as an `uncaughtException`, which `test/preload.ts:17-20` re-throws because it only
lets `ERR_STREAM_DESTROYED` through.

**Why the test was reverted rather than patched.** All three test-side workarounds were tried and each is worse:
a longer sleep (forbidden, and slower); stopping earlier (reproduced above, worse); a scoped
`unhandledRejection` listener (does not work â€” Bun delivers it as `uncaughtException`, and the preload re-throws
from its own listener regardless). Patching the symptom would also have meant adding a swallow.

### NEEDS-OWNER â€” exact patch for lane B, `packages/unifia/src/mcp/index.ts`

At line 850, let the failure path own the promise. Same shape as the `pending`/`track` pattern already used in
`src/lsp/client.ts`:

```ts
// MCP.authenticate: a callback promise created eagerly and not always awaited.
// If open() fails, the Effect short-circuits and this promise is left dangling;
// McpOAuthCallback.stop() then rejects it with no listener and the unhandled
// rejection is attributed to whichever test is running. Own it here instead.
const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)
// Never unhandled: whatever happens below, this promise has a rejection handler.
callbackPromise.catch((err) => log.warn("oauth callback abandoned", { mcpName, error: err }))
```

After that lands, the fixed 2 s sleep in `oauth-browser.test.ts` can become a condition wait on `open()`. That
change is deliberately **not** included: it only becomes safe once the rejection is handled, and it was measured
to fail today.

---

## A2 / #57 â€” instance-capacity LRU: NOT REPRODUCIBLE, test hardened, **not claimed fixed**

**Measurement first:** `bun test test/project/instance-capacity.test.ts` â€” 5 consecutive runs, `6 pass / 0 fail`.
`bun test test/project/` (78 tests) â€” 5 consecutive runs, `78 pass / 0 fail`. Ten green runs.

**First hypothesis, tested and refuted, then withdrawn.** The obvious defect is that the cap is enforced
against a module-level cache the whole suite shares â€” 95 test files call `Instance.provide`, only 46 call
`disposeAll` â€” while the assertions were absolute. A disposable test left 4 instances resident and then ran #57's
assertions verbatim. It **passed**: the leaked entries were evicted before `b`. So ordering alone does not break
it, and the hypothesis is withdrawn rather than quietly kept.

**What is left is real and measured.** Two hazards remain, both of which the file can own:

1. it measured a shared cache without owning it, so the verdict depended on 49 other files' disposal timing â€”
   `Instance.disposeAll()` is idempotent and resets its own memo (`src/project/instance.ts:340`), so a
   `beforeEach` gives a known-empty baseline;
2. evicting runs `State.dispose` / `disposeInstance` for the victim, and that teardown (watchers, LSP) can
   re-enter `provide` and land other directories in the cache while the eviction loop is still running â€” exactly
   the "async disposal timing (watchers/LSP teardown)" hazard #57 names. The assertions are now scoped to the
   directories the test creates, which still pins the eviction decision precisely (`b` gone, `a` and `c`
   resident) and is insensitive to unrelated traffic.

**Executed proof:** 5 consecutive runs, `6 pass / 0 fail`; and 5 runs of `test/project/` after the change,
`78 pass / 0 fail`.

**Not claimed fixed.** The CI failure was not reproduced here in ten runs. The two remaining candidates are both
product-side â€” a `leaseCounts` entry leaking from another file, and the `pendingDisposals` early return at
`src/project/instance.ts:275-278` â€” and out of scope. Recorded for whoever picks the CI run up.

---

## A2 â€” four more blockers, found by the first FULL `bun test`, all harness defects

`bun test` in `packages/unifia` was **not green on `dev`**, which is what `unit (windows)` runs, so A2's own
criterion was unreachable without dealing with these. First full run on the untouched tree, `origin/dev` @
`39cf4435ab`: `5332 pass / 12 skip / 4 fail` (771 s). All four are the harness; no product code is touched.

### The two plugin concurrency files could not pass on a developer machine at all

`test/plugin/install-concurrency.test.ts` and `test/plugin/meta.test.ts` spawn 8-12 child bun processes and
assert each exited `0` **with empty stderr**. `Process.spawn` builds the child env as
`{ ...process.env, ...opts.env }` (`src/util/process.ts:66`), so the workers inherited
`OPENCODE_SERVER_PASSWORD` / `_USERNAME` / `OPENCODE_CLIENT` â€” all three set on this box. The flag module warns
for any *defined* setting, testing `!== undefined` rather than truthiness (`src/flag/flag.ts:116-121`), and
writes that to stderr. **Measured: 5/5 runs failing with the variables set, 5/5 passing with them cleared**, and
the captured stderr was nothing but the `[flag] ignoring ...` banner.

The fix is `env: null`, which reaches `launch` as `{}`. **`""` does not work and deleting the key does not
either** â€” `...process.env` re-supplies it; both were tried and measured before settling on `env: null`. The
workers need no environment: `plug-worker.ts` takes everything from argv, and `plugin-meta-worker.ts` sets
`UNIFIA_PLUGIN_META_FILE` from its own payload before importing `PluginMeta`.

### The `exit 9`, and a hypothesis of mine that measurement refuted

The first guess â€” that `Process.run`'s `opts.timeout ?? 5_000` was SIGKILLing workers
(`src/util/process.ts:81`) â€” was **wrong**, and is recorded because it was acted on before being checked: that
timer is only armed inside `abort()`, so it never runs when no abort signal is passed. The real shape, visible
only after the assertion was rewritten to report it:

```
#0  exit=0 stderr="[flag] ignoring OPENCODE_SERVER_PASSWORD..."
#2  exit=9 stderr=""        #4  exit=9 stderr=""        #7  exit=1 stderr=""
```

`exit 9` with empty stderr is a child that died before writing anything â€” spawn/resource pressure under load.
It could not be reproduced standalone: **96/96 clean** in a direct probe (8 rounds x 12 workers), and 72/72
clean with an explicit child timeout. It only appears when the whole file runs, i.e. under real contention. So
it is **not claimed fixed**; what changed is that the test now names the worker, its mod and its stderr instead
of emitting a bare list of exit codes, which is why `exit 9` previously looked like a mystery.

**Executed proof:** `bun test test/plugin/` â€” 5 consecutive runs, `72 pass / 0 fail`, `exit 9` absent from all
five.

### cli-process: a 30 s timeout that measured nothing

`test/knowledge/e2e/cli-process.test.ts` drives the real CLI and, with no `dist/`, falls back to the **source
entrypoint**. Per-test timings showed a one-time cost rather than latency: the first spawn paid bun's transpile
for `src/index.ts` at **12537 ms** against 6-11 s for every later spawn. Under full-suite load that one-off
crossed the 30 s budget and failed having measured nothing about the product. **The timeout was not raised.** A
warm-up now runs in `beforeAll`, outside every per-test budget, skipped when `dist/` exists (the CI case, where
the compiled binary answers in ~1.6 s).

**Executed proof:** 5 consecutive runs, `11 pass / 0 fail`, first test **8460 / 8407 / 7556 / 8297 / 9151 ms** â€”
down from 12537 ms and now inside the same band as every other test in the file.

### A2 verification â€” the card's own criterion

`bun typecheck` (`tsgo --noEmit`) exit 0. `bun test --timeout 180000` in `packages/unifia`, **three consecutive
green runs**:

```
run 1:  5336 pass  12 skip  0 fail  87353 expect()  1162.42s  EXIT=0
run 2:  5336 pass  12 skip  0 fail  87353 expect()   976.50s  EXIT=0
run 3:  5336 pass  12 skip  0 fail  87353 expect()   720.33s  EXIT=0
```

Baseline for comparison: `5332 pass / 4 fail` on the untouched tree. Rebased onto a freshly fetched
`origin/dev` @ `a71cd08d27` (the five files touched are unchanged between the two SHAs, verified with
`git diff --stat` before rebasing) and re-verified there: `5336 pass / 0 fail / EXIT=0`.

---

## A2 â€” merge, and the CI gate

**PR #310 merged by squash: `939441437c31284b1f9dd4c9ee833d194d777c71`.** 5 files, +141 / -17, from
`agent/A-A2-windows-unit`. All seven required checks green on the exact head `e9757e5417`, plus `CodeQL` and
`Analyze`.

`rust unit tests` first returned `cancelled` with `steps=0`. That is not a failure: nine other jobs on the same
PR reported `fail` all at 15m0x-15m2x, the signature of cancellation rather than of running code, and at one
point 12 of the 30 most recent runs were `queued` because four agents were pushing simultaneously. Re-running the
cancelled jobs cleared them; `rust unit tests` needed a second attempt because its run was still `in_progress`
while `e2e (linux)` held it, and `gh run rerun` refuses a run that is still going.

**`unit (windows)` is green on three consecutive PR heads** â€” `e9757e5417` (#310), `29cdf245ac` (#317) and
`b5e84c233a` (#323). That is A2's stated criterion.

**`merge-and-size` stays red and is not a size problem.** The log says `fatal: refusing to merge unrelated
histories`, exit 128: `work-design-integrity.yml` does `git fetch origin dev --depth=1` then `git merge-tree
--write-tree origin/dev HEAD`, and with a depth-1 fetch of a base that is not an ancestor of a shallow head,
merge-tree reports unrelated histories. Not a required check, so not pursued further; recorded because "PR size
limit exceeded" is what the next person will assume they are looking at.

### A2 is NOT closed, and why

- **#57 was never reproduced** â€” ten green runs, and a pollution experiment that *passed*. The test is
  hardened against two measured hazards; the CI failure is not claimed fixed. Both remaining candidates are
  product-side and out of scope.
- **#56 is half addressed** â€” the FakeConnector race is fixed and proven; the `BrowserOpenFailed` 180 s hang is
  a product defect filed above as NEEDS-OWNER, and the test was reverted rather than patched because every
  workaround was tried and each was worse.

Neither issue is closed by #310. Both stay open for the owner.
