<!-- SPDX-License-Identifier: MIT -->
# journal - lane D (security, dependencies, release rehearsal, QA12R)

Lane D of the Unifia RC-0 release-1 push. Base branch `dev`. Cards D1, D3, D2,
D4, D5, worked in that order. Every entry records the commands that were run and
what they printed, because a status without an executed trace is not a status.

`EXECUTION-LOG.md` is not edited from this lane. This file is appended to.

---

## 2026-10-05 - lane D setup

Worktree `C:\Users\barat\AppData\Local\Temp\opencode\unifia-laneD`, added from
`C:\Users\barat\unifia` - the only clone on this machine carrying
`github.com/Rwanbt/unifia`. `D:\App\unifia` has a `.git` holding only
`info/exclude` and is not a repository (`git -C` there: "not a git repository").
`bun install --frozen-lockfile` -> `2403 packages installed [289.83s]`, no
postinstall failure.

Interpretation recorded once, because the card text and the write-scope line do
not agree. The strict write scope names `package.json`, `bun.lock`, `.github/**`
and `docs/security/**`, and the cards then require product edits (`#155` TUI temp
files, `packages/console/app` config, the release workflow). The cards are what
the lane is for, so the product files each card names are treated as in scope and
nothing else is touched. The exclusive parts of the write scope are honoured:
this lane is the only one touching manifests and the lockfile, and it never edits
`EXECUTION-LOG.md`.

`rg` is not installed on this machine (`where.exe rg` finds nothing), so the
card's search command was run as
`git grep -n -I "unifia\.ai" -- . ':(exclude)*.lock' ':(exclude)node_modules'`,
which searches tracked files only and is therefore at least as strict. Recorded
rather than silently substituted.

---

## D1 - security gate

### Baseline, measured before any change

`gh api "repos/Rwanbt/unifia/code-scanning/alerts?state=open&per_page=100"`
paged to exhaustion: **223 open alerts**, no page empty before page 3.

All 223 carry `most_recent_instance.commit_sha =
207ff452b8056ae11f1f71e23198e520835f70ed`. What that commit is, measured:

```
git log -1 207ff452b              Merge pull request #16 from Rwanbt/dev
git rev-parse origin/main         207ff452b8056ae11f1f71e23198e520835f70ed
git merge-base --is-ancestor 207ff452b origin/dev    exit 0
```

So the newest analysis producing any of them is the analysis of `main`'s head,
and `main` is an ancestor of `dev`. The two analyses after it, both on `dev`,
both green:

| analysis | commit | created (UTC) | results | rules | error |
|---|---|---|---|---|---|
| 1894496010 | 871e8f04 | 2026-10-05T15:31:24Z | 22 | 103 | (empty) |
| 1894564662 | 26ba494d0 | 2026-10-05T15:40:50Z | 22 | 103 | (empty) |

Anchor check of all 223 against the `dev` tree (path exists, and the file still
has at least `start_line` lines):

| anchor state | alerts |
|---|---|
| `PATH_ABSENT` | 101 |
| `ANCHOR_GONE` | 2 |
| `ANCHOR_VALID` | 120 |

Of the 46 alerts carrying a `security_severity_level`: 29 `PATH_ABSENT`,
1 `ANCHOR_GONE`, **16 `ANCHOR_VALID`**. Those 16 are the only ones that can still
describe `dev`, so they are the only ones that got a decision. 62 of the 101
absent paths are under `packages/opencode/`, which the rebrand renamed to
`packages/unifia/`.

Correction recorded: the first pass used `Measure-Object -Line`, which does not
count blank lines, and reported 4 files as `ANCHOR_GONE` that are not. Those
numbers were discarded and recomputed with `@(Get-Content).Count`.

### #155 - already fixed at source, verified, not rewritten

`packages/unifia/src/cli/cmd/tui/util/editor.ts` already does all four things
`#155` asks for: `mkdtemp(join(tmpdir(), "unifia-editor-"))` at line 14 for the
private directory, `writeFile(filepath, opts.value, { flag: "wx", mode: 0o600 })`
at line 18 for exclusive creation at owner-only permissions,
`defer(... rm(dir, { recursive: true, force: true }))` at line 15 for removal, and
the editor still reads and writes the file. It landed as `7a9a3569f fix(tui):
secure external editor temporary files`, which `git branch -a --contains` puts on
`dev`. Alerts #389 and #390 report `state: "fixed"` on `refs/heads/dev`.

`bun test test/cli/tui/editor.test.ts` in `packages/unifia` on `dev@26ba494d0`:

```
(pass) editor creates private isolated files and removes them after exit [194.31ms]
 1 pass
 0 fail
 6 expect() calls
```

That test covers both acceptance criteria not visible in the implementation:
`Promise.all` over two `Editor.open` calls, then `new Set(filepaths).size === 2`
with the two contents sorted equal to the two inputs (concurrent invocations do
not collide or cross-contaminate), and `readdir(temp) === []` after exit and after
a startup failure, plus `fileMode === 0o600 && dirMode === 0o700` off Windows.

### PR #297 - the 16 live security alerts, 9 fixed

`squash 78f9d01cfd280a2918c047702c6626cc8eeacd82`, base `dev@26ba494d0`, 237
changed lines. All 7 required checks and CodeQL/Analyze green on head
`b791f6b01b93fa22c62c0cb0fb928df40a43409d`.

| alert | rule | file | decision |
|---|---|---|---|
| 14 | `js/request-forgery` (critical) | `github/index.ts:465` | FIXED |
| 23 | `js/log-injection` | `github/index.ts:472` | FIXED |
| 2, 3, 4 | `js/incomplete-sanitization` (high) | `packages/console/core/script/{promote,pull,update}-models.ts` | FIXED |
| 5 | `js/insecure-sanitization` (high) | `packages/desktop-electron/src/main/apps.ts:23` | FIXED |
| 8, 35 | `js/shell-command-injection-from-environment`, `js/indirect-command-line-injection` | `scripts/bundle-mobile.mjs:67` | FIXED |
| 21 | `js/identity-replacement` | `packages/console/app/src/routes/workspace/common.tsx:18` | FIXED |
| 1 | `js/double-escaping` (high) | `packages/ui/src/context/marked.tsx:75` | disposition (a) |
| 20 | `js/biased-cryptographic-random` (high) | `packages/util/src/identifier.ts:23` | disposition (b) |
| 26 | `js/insecure-temporary-file` (high) | `packages/desktop-electron/src/main/cli.ts:86` | disposition (c) |
| 278 | `js/polynomial-redos` (high) | `packages/app/src/components/connect/remote-connect.tsx:20` | disposition (d) |
| 16, 17 | `js/prototype-polluting-assignment` | `packages/sdk/js/src/v2/gen/core/params.gen.ts` | disposition (e) |
| 24 | `js/log-injection` | `packages/app/src/components/terminal.tsx:279` | disposition (f) |
| 496 | `js/http-to-file-access` | `packages/ui/vite.config.ts:56` | disposition (g) |

**#14 + #23.** `getUserPrompt()` built `fetch(url)` from a model-produced prompt
and attached `Authorization: Bearer ${accessToken}` to it, then wrote that URL to
the log with `console.error`. New `github/attachment-url.ts` exports
`attachmentUrl()`, which parses the string and returns it only when the protocol
is `https:`, the origin is exactly `https://github.com`, and the pathname starts
with `/user-attachments/`; anything else is `null` and the loop `continue`s before
a header is built. `logSafe()` flattens `[\x00-\x1f\x7f]` to spaces and truncates
at 200 characters. `github/index.ts` calls both and uses
`path.basename(attachment.pathname)`.

A measurement changed the test rather than the other way round: `new URL()`
resolves `..` before the pathname is read, so
`https://github.com/user-attachments/../../settings/tokens` arrives as
`/settings/tokens` and is refused. The test asserts that normalisation instead of
asserting it passes, because the normalisation is why the check cannot be
sidestepped by respelling the path.
`bun test attachment-url.test.ts` -> 4 pass, 0 fail, 30 expect() calls.

**#2 + #3 + #4.** All three wrote `KEY="${v.replace(/"/g, '\\"')}"` into the env
file handed to `sst secret load`. The value is a JSON document read back from
`sst secret list`, so it contains escaped-quote pairs by construction: escaping
only the quote turned that pair into a double backslash followed by a quote,
which closes the quoted value early, and a value ending in one backslash escaped
the closing quote of its own line the same way from the other side. New
`packages/console/core/script/env-value.ts` escapes the backslash first and the
quote second. The test carries a small quoted-env parser and asserts a
byte-identical round trip.
`bun run test` in `packages/console/core` -> 9 pass, 0 fail, 33 expect() calls.

That test was checked against the code it replaces. With the escaping reverted to
`value.replace(/"/g, '\\"')` and nothing else changed,
`bun test core/script/env-value.test.ts` -> **0 pass, 3 fail**, and the diff shown
was `ZEN_MODELS2="x\\"` expected against `ZEN_MODELS2="x\"` received - the
trailing backslash swallowing the line's closing quote. Restored, back to 3 pass.

**#5.** `checkMacosApp` interpolated an IPC-supplied `appName` into
`/Applications/${appName}.app`, so `../` or a second separator could aim the
`existsSync` probe anywhere, and the same string went to `which`. New exported
`isBundleName()` rejects an empty or over-long name, `.`, `..`, and anything
containing `/`, `\` or a control character, and `checkMacosApp` returns `false`
before building a path or spawning anything.
`bun run test` in `packages/desktop-electron` -> 22 pass, 0 fail, 71 expect() calls.
`bun run typecheck` -> exit 0.

**#8 + #35.** `scripts/bundle-mobile.mjs` joined the `bun build` argument list
into one string and passed it to `execSync`, i.e. through a shell, with `outdir`
from `--outdir` on the command line and `ROOT` from the script's own location.
Now `execFileSync(cmd[0], cmd.slice(1), ...)` spawns no shell.

**#21.** `formatDateForTable` ended in `.replace(",", ",")`, a replacement of the
first comma with the comma already there. Removed, with a comment saying so.

Typecheck in every touched package, before the commit:

| command | result |
|---|---|
| `bun run typecheck` in `packages/desktop-electron` | exit 0 |
| `bun run typecheck` in `packages/console/core` | exit 0 |
| `bun run typecheck` in `packages/console/app` | exit 0 |
| `bunx tsc --noEmit -p tsconfig.json` in `github` | 4 errors, all pre-existing |

The four `github` errors are at `index.ts` 580/593/594/614 on clean `dev`
(`isScheduleEvent`, `UnifiaClient.agent`, implicit `any`, `Session.chat`) and at
594/607/608/628 with the change - the same four, shifted by the 14 lines added
above them. Verified by stashing the change and re-running, not by reading the
diff. `github/` has no `typecheck` script and is not in the turbo pipeline, so CI
does not check it and it was checked by hand.

Issue **#155 closed** with the merge SHA and that evidence. Issue **#30 left
open** until the dispositions land.

---

## D3 - the `unifia.ai` domain

Search before the change, on `dev@78f9d01c`, found four executable sites, all in
`packages/console/app`:

| site | what it did |
|---|---|
| `src/config.ts:6` | `baseUrl: "https://unifia.ai"` |
| `src/component/locale-links.tsx:28-34` | canonical + hreflang alternates + x-default |
| `src/routes/go/index.tsx:221`, `src/routes/black.tsx:76` | `og:url` |
| `src/routes/index.tsx:121`, `src/routes/download/index.tsx:124`, `src/routes/temp.tsx:70` | copyable install command |
| `src/routes/legal/terms-of-service/index.tsx:87` | "our site located at unifia.ai" |

The worst was worse than a dead link: on `/download` the button copied
`curl -fsSL https://opencode.ai/install | bash` while the code printed beside it
read `unifia.ai/install`. What a user read and what a user pasted named different
hosts. `packages/web/config.mjs` already states the rule this applies, in its own
header: writing a domain nobody holds is worse than having none, because it
presents dead links as official.

**PR #298**, `squash da48cba502abab914b97d51252f3253af8262175`, 257 changed
lines. `config.baseUrl` is now
`readBaseUrl(import.meta.env.VITE_UNIFIA_BASE_URL)` with **no default**, so it
fails closed. `readBaseUrl` rejects credentials in the authority, any path, query
or fragment, any scheme other than `https:`, and plain `http` off loopback; a
value failing any of those is treated as absent, because a half-valid origin
yields a canonical link that is wrong rather than one that is missing. With no
origin, `LocaleLinks` returns `null`, the two `og:url` tags are not rendered, and
the three install surfaces show "No install channel is configured for this
deployment" with the copy button gone. `installCommand()` and `installPath()`
derive the command and its highlighted label from the same origin, which closes
the read-here / paste-there divergence permanently instead of for one string.

The three new i18n keys go in `en.ts` only: `i18n()` merges each locale over the
English base (`{ ...base, ...de }`), so the other 16 fall back rather than losing
a key, and `Key = keyof typeof en` so the type still holds.

```
bun run test          # packages/console/app
  6 pass  0 fail  25 expect() calls

bun run typecheck     # packages/console/app
  exit 0
```

`ReadBaseUrl_IsNullWhenUnset` asserts the fail-closed half directly -
`undefined`, `null`, `""` and `"   "` all give `null`, and `installCommand(null)` /
`installPath(null)` give `null` - so there is no literal left that could
reintroduce a fallback.

What the search returns now, in `packages/console/app/src`, is four lines and all
four are comments stating the domain is not owned (`src/config.ts:9`,
`src/config.ts:57`, `src/config.test.ts:9`, `src/routes/index.tsx:118`). The other
`unifia.ai` mentions in the repo are root-level markdown documenting the same
decision, plus three comments stating it: `.github/workflows/test.yml` explains
the `users.noreply.github.com` author address, `github/action.yml` explains why
`unifia.ai/install` is never used, `packages/web/config.mjs` states the policy.

Issue **#31 closed** with the merge SHA and that evidence.

Not addressed, and deliberately: `packages/web/src/content/docs/**` carries about
150 localized `.mdx` files where `unifia.ai/config.json` is a display label whose
`href` already points at `opencode.ai/config.json`. That is a label/href
divergence inside documentation content rather than an executable surface, it
spans 17 locales, and `PROD_READINESS.md:127` already records the same class
against `packages/app`. It is left for a card that owns `packages/web`, so this
lane does not reach into a package another lane may be touching. **D3 residual,
recorded not hidden.**

---

## D2 - dependency advisories

`bun audit` on `dev@56ad2a2ad`: **5 vulnerabilities, 2 high, 2 moderate, 1 low**.
The previously recorded state was "2 moderate and 2 low", so the two highs are
new relative to that note.

| # | advisory | severity | package | outcome |
|---|---|---|---|---|
| 1 | GHSA-ch52-4w7c-c8xp | high | `http-cache-semantics <=4.2.0` | FIXED, PR #304 |
| 2 | GHSA-vfj7-8cjw-p6xm | high | `braces <=3.0.3` | no version exists; bounded + accepted |
| 3 | GHSA-wrjc-x8rr-h8h6 | moderate | `react-router >=6.0.0 <7.18.0` | acceptance |
| 4 | GHSA-337j-9hxr-rhxg | moderate | `react-router >=6.4.0 <7.18.0` | acceptance |
| 5 | GHSA-j965-2qgj-vjmq | low | `aws-sdk >=2.0.0 <=3.0.0` | acceptance |

### PR #304 - `http-cache-semantics` 4.2.0 -> 4.3.0

`squash e3aa2f3daf10871397eaa2f053a4dce1a9004364`, one manifest and one lockfile,
12 changed lines.

4.3.0 is published and outside the `<= 4.2.0` range. `bun why http-cache-semantics`
lists every path in and every consumer's declared range already admits 4.3.0:

```
astro               requires ^4.2.0
cacheable-request   requires ^4.0.0
make-fetch-happen   requires ^4.1.1
```

so no consumer is moved outside its own semver range and none of the duplicate-type
traps this repo has hit before applies. `bun.lock` resolves
`http-cache-semantics@4.3.0`.

```
bun turbo typecheck --concurrency=1     Tasks: 48 successful, 48 total
bun run test   # packages/desktop-electron, the electron / electron-builder importer
  22 pass  0 fail  71 expect() calls
```

`packages/unifia` is the other importer (`src/npm/index.ts` imports
`@npmcli/arborist`). Its full suite was run at 4.2.0 and again at 4.3.0 and the
result is reported as measured, not as a clean pass:

| version | full-suite result |
|---|---|
| 4.2.0, clean `dev` | 5 fail |
| 4.3.0, first full run | 21 fail |
| 4.3.0, second full run | 13 fail |
| 4.3.0, `test/file/index` + `test/tool/grep` + `test/tool/skill` in isolation | 0 fail |
| 4.2.0, the same three files in isolation | 0 fail |

The failing set is not stable at the same version, and those tests pass when
their file is run alone. They are process-contention and wall-clock tests -
`util.flock`, `R-0019` knowledge-core cases spawning a real process against a 30 s
timeout, the ripgrep and file-watcher cases - and none is in the import path of
`http-cache-semantics`. So: no regression attributable to the bump, established
by isolation and by the dependency graph rather than asserted from the counts.
The suite's instability on this host is recorded rather than absorbed.

### PR #309 - `braces`, and the acceptances

The high that no lockfile change can close. `npm view braces version` -> `3.0.3`,
the newest published version, and it is inside the advisory's `<= 3.0.3` range, so
the set of non-vulnerable versions is empty.

It is **not** a build-time-only finding. `bun why braces` puts one path in shipped
code: micromatch -> `@parcel/watcher` -> unifia.
`packages/unifia/src/file/watcher.ts:3` imports `@parcel/watcher/wrapper`, whose
`wrapper.js:17` calls `micromatch.makeRe(value)` on every ignore pattern, and
`packages/unifia/src/config/config.ts:707-713` merges project config files found
by walking up from the working directory unless `UNIFIA_DISABLE_PROJECT_CONFIG` is
set. A cloned repository can therefore put a pattern into `watcher.ignore`.

What it costs, measured rather than assumed, because the mechanism does not match
the advisory's description:

| nested braces | `micromatch.makeRe` |
|---|---|
| 1 000 | 46 ms |
| 5 000 | 783 ms |
| 20 000 | **12 731 ms** |
| 100 000 | `SyntaxError`, V8's own 65536-char regex ceiling |

Superlinear compile cost rather than a stack overflow, but a denial of service in
substance: 12.7 s on the watcher-init path, with a hard stop only once the
pattern is large enough to trip V8. Combinatorial shapes (`{a,b}` repeated) were
probed too and are cheap - 30 repetitions under a millisecond.

So the bound: `FileIgnore.MAX_BRACE_DEPTH = 32` with `isPathologicalPattern()`
and `boundPatterns()`; `FileWatcher` applies it to `cfg.watcher.ignore` and logs
every pattern it drops, because a dropped ignore pattern means watching more than
the user asked and that must not fail silently.
`bun test test/file/ignore-glob-depth.test.ts test/file/ignore.test.ts test/file/watcher.test.ts`
-> 24 pass, 0 fail, 98 expect() calls.

`bun run typecheck` in `packages/unifia` -> exit 0. Full suite -> 5339 pass,
12 skip, 5 fail, and those 5 are the same 5 that fail on clean `dev` without the
change (`plugin.install.concurrent` x3, `plugin.meta` x1, and one `R-0019`
knowledge-core case that spawns a real process against a 30 s timeout; that last
one is not stable - a different `R-0019` case fails on each run and all pass when
their file is run alone).

`react-router` and `aws-sdk` are written up with their dependency paths and
reachability arguments in `docs/security/DEPENDENCY-ACCEPTANCES.md`, in the same
PR. `braces` acceptance is marked **NEEDS-OWNER**: bounding exploitability does
not change what `bun audit` reports, and whether to ship release 1 with a standing
high advisory is the owner's call (DECISIONS.md, actions reservees au proprietaire).

**CI outcome on PR #309, recorded as it happened.** The first run failed with
every `ubuntu-latest` job concluding at 15m1s-15m2s, `runner_name: ""`, no steps,
and the annotation:

```
The job was not acquired by Runner of type hosted even after multiple attempts
```

That is GitHub hosted-runner starvation, not the change: it started repo-wide when
another lane pushed `agent/A-A2-windows-unit` at 2026-10-05T20:44:36Z, queuing 14
workflow runs at once. Re-running the failed jobs on the identical head
`bd41d97f51ff17d46376cc4223bfa1f29367ffad` reproduced the same 15m no-runner
cancellations for `typecheck`, `check-compliance`, `merge-and-size`, `nix-eval`,
`e2e (linux)`, `rust unit tests` and `sdk in sync with server`, while the jobs that
did get a runner passed - `Analyze (javascript-typescript)` 3m35s,
`unit (linux)` 9m34s, `conformance` 2m32s, `check-standards` 5s, `check` 10s/11s.

---

## D4 - release rehearsal without publishing

### The card was already delivered, by the owner, and I missed it

PR **#312** (`agent/D-4-release-dry-run`) was cut by this lane with the three
guards the card asks for, and then closed as superseded. The reason: **#294**
(`agent/rc0-d8-release-dry-run`, author `Rwanbt`, opened 2026-10-05T15:18:33Z) is
the same card, done by the owner, and it is strictly stronger.

On the three guards the two are identical - `release`,
`publish-npm` and `publish-docker` all gain `!inputs.dry_run`. Where #294 is
better is the point this lane got wrong:

| | #294 | #312 (closed) |
|---|---|---|
| Tauri updater key in a dry run | throwaway keypair generated in-run; the release identity is never read | `secrets.TAURI_SIGNING_PRIVATE_KEY` still used |
| run-time assertion of the contract | `dry-run-verdict` job checks the artifact list and fails if the tag already exists | none |

This lane's #312 argued in a comment that the signing key could not be removed
because `tauri.prod.conf.json` ships an updater public key and Tauri hard-fails
without a matching private key. The argument was right about the cause and wrong
about the conclusion: the key cannot be **absent**, but it can be **replaced**,
which is exactly what #294 does with `cargo tauri signer generate --writable
"$RUNNER_TEMP/..." --password "dry-run-ephemeral"`. A dry run that signs with the
owner's release identity is the thing D8-B asked not to happen. Recorded because
it was my error, not a formatting quibble.

The miss itself is the process lesson: this lane cut a branch without re-checking
the open-PR list against its own card ID. #294 predates this lane's D4 work by
hours. Checking for an existing PR on your own card is cheap and this lane did not
do it.

#294 also carries unrelated `packages/browser-runtime/**` and
`docs/adr/ADR-089-browser-node-host.md` changes on the same branch, which whoever
merges it may want split out.

### SBOM / SLSA evidence: none, and not fixable in this pipeline

This is the D4 question the card asks explicitly, and the answer is the same
whichever implementation wins.

| workflow | trigger | consequence |
|---|---|---|
| `sbom.yml` | `workflow_dispatch` only | never fires automatically |
| `release-sign.yml` | `workflow_dispatch`, `tag` input **required** | cannot run in a dry run: there is no tag |
| `slsa.yml` | `workflow_call` only | nothing under `.github/**` calls it |

So `release.yml` emits **no SBOM, no SLSA provenance and no artifact signature**,
in a dry run or otherwise. A dry run cannot rehearse that evidence, and neither
can a real release from this pipeline. `RELEASE-PIPELINE.md` ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§2 step 5 lists
SBOM, signing and provenance as step 5 of a release; the reality is three
separately dispatched workflows, two of which need a release that already exists.
That gap should be visible before release 1, and it is an owner decision whether
to wire them in or to accept their absence.

### Baseline for the proof, measured before any dispatch

```
gh release list                        -> 3 releases: v0.2.1-fork, v0.2.0-fork, v0.1.0-fork
git ls-remote --tags origin            -> 1001 tags
```

The proof procedure itself is owner-only, because a `.github/**` change is
owner-merged (DECISIONS.md, D11) and a dispatch has to be on the merged workflow:

```
gh workflow run release.yml --ref dev -f tag=v1.3.16-rc.0 -f draft=false -f dry_run=true
gh run list --workflow release.yml --limit 1     # record the run id
gh release list                                  # must still be 3
git ls-remote --tags origin                      # must still be 1001
```

**D4 status: NEEDS-OWNER.** The mechanism exists in #294 and was verified by
reading its diff against the job graph; the executed proof is gated on the owner
merging it. No run ID is claimed, because no dispatch was made.

---

## D5 - QA12R on a frozen SHA: BLOCKED on the card's own precondition

The card says: *"ONLY when lanes A, B, C have each written a final summary in
their journal."* Measured on `dev@b72f3ce95`:

```
git ls-tree -r --name-only origin/dev -- docs/autonomy/rc0 | grep journal
  docs/autonomy/rc0/journal-B.md
  docs/autonomy/rc0/journal-C.md
```

**Three independent failures, all of which have to clear:**

1. **Lane A has no journal at all.** `journal-A.md` does not exist on `dev`. Lane
   A's PR #310 (`agent/A-A2-windows-unit`) is open and unmerged.
2. **Lane B has a journal but no final summary.** Its last entry is a card table
   whose own PR row reads *"the number and merge SHA are recorded in the final
   summary entry at the end of this journal (this row is written before the PR
   exists)"* - i.e. the summary is promised and not yet written. PRs #306 and #307
   are open.
3. **Lane C has a journal but no final summary.** Its last entry is card ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§3.7.
   PR #308 is open.

Independently of the journals, **freezing a SHA now would be wrong**: nine PRs
were open against `dev` at the time of writing (#289, #292, #294, #295, #306,
#307, #308, #310), so any SHA frozen today would not be the integration point.
`RL00` exists to freeze the candidate SHA precisely after the lots land.

So no gate was executed and **no PASS is claimed for any of the eight gates in
`PLAN-RC0-FASTTRACK.md` ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§5**. Writing the report now would mean eight rows of
NOT EXECUTED, which is what the card anticipates for VO04 and QA08 anyway, so the
file was not created on a premature freeze.

**What this lane can already contribute to that report**, recorded so it is not
re-derived later - gates 2 and 7, this lane's own cards:

| ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§5 gate | lane-D contribution | state |
|---|---|---|
| 2 (QA04-QA07 security and dependencies) | D1, D3, D2 merged; #155 and #30 closed; #31 closed | DONE |
| 7 (QA09 dry run, no publish) | mechanism in the owner's #294, verified by diff; executed proof owner-only | NEEDS-OWNER |

VO04 (physical voice qualification) and QA08 (physical mobile QA) are owner-only
and out of scope for this week; they are NOT EXECUTED and are not lane D's to run.

**D5 status: BLOCKED.** Diagnosis: the card's precondition - one final summary per
lane from A, B and C - is not met, and nine open PRs make a freeze premature.
Re-check when lane A merges its journal and B and C append their summaries.

### One more item routed to this lane and answered

Lane C's journal ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§3.6 raises the Voice CI required-check problem and routes the
decision here as `.github` / branch-protection work. Verified:

```
.github/workflows/voice-ci.yml
  on:
      branches:
        - voice
      paths:
        - "packages/voice-host/**"
        ...
```

The workflow only runs on the `voice` branch and only when Voice paths change, so
it can never report on a PR against `dev` and can never satisfy a required status
check there. Lane C's finding is correct.

**Answer: NEEDS-OWNER, not a lane-D change.** The two options are a second
always-running lightweight Voice check, or dropping the path filters so the
existing one reports on every PR. Both are workflow or branch-protection edits, and
DECISIONS.md reserves workflow changes to the owner (D11), as does the repo's own
branch protection on `dev` (`required_status_checks` on `dev` lists exactly seven
contexts, and changing them is a repository setting). It is also a policy call
about how long a PR waits, which is not this lane's to make.

---

## Final summary - lane D

| card | PRs | outcome |
|---|---|---|
| **D1** (QA04, #30 #155) | #297 `78f9d01c`, #311 `b72f3ce95` | **DONE.** 9 of the 16 live security alerts fixed with regression tests; the other 7 dispositioned with proving traces; a row for all 223 open alerts. #155 and #30 closed. |
| **D3** (QA07, #31) | #298 `da48cba5` | **DONE** for the executable surfaces. `config.baseUrl` is environment-provided with no default and fails closed. #31 closed. Residual recorded: ~150 localized `packages/web/src/content/docs/**` files carry a `unifia.ai/config.json` display label whose href is already `opencode.ai`, left for a card that owns `packages/web`. |
| **D2** (QA05, #33) | #304 `e3aa2f3da`, #309 `71b6caf7f` | **DONE** for everything a lockfile can do. `http-cache-semantics` high fixed; `braces` high has no patched version published, bounded at the product boundary and written up; `react-router` moderate x2 and `aws-sdk` low accepted in `docs/security/DEPENDENCY-ACCEPTANCES.md`. **NEEDS-OWNER** on the residual `braces` high: whether to ship release 1 with it is the owner's call. |
| **D4** (QA09) | #294 (owner's, verified), #312 (closed as superseded) | **NEEDS-OWNER.** Mechanism exists and was verified by diff; the executed proof dispatch is owner-only because `.github/**` is owner-merged. Baseline recorded: 3 releases, 1001 tags. SBOM/SLSA: none produced by `release.yml` in any mode. |
| **D5** (QA12R) | none | **BLOCKED** on the card's own precondition: lane A has no journal, lanes B and C have no final summary, and nine PRs are open so a freeze is premature. No gate executed, no PASS claimed. |

**Issues closed by this lane:** #155, #30, #31. **PRs merged:** #297, #298, #304,
#309, #311. **PRs closed unmerged:** #312 (superseded by the owner's #294).

**Two things I got wrong, both recorded above rather than quietly dropped:** the
first CodeQL anchor pass used `Measure-Object -Line`, which skips blank lines and
misclassified four files; and D4's signing argument concluded the release key
could not be avoided when it could only be *replaced*.

**One thing left for the owner, collected:** whether to ship release 1 with the
unpatchable `braces` high; whether `release.yml` should be wired to the SBOM/SLSA/
signature workflows or their absence accepted; and the Voice CI required-check
policy, which is `.github` and branch-protection work and therefore not a lane-D
change.
