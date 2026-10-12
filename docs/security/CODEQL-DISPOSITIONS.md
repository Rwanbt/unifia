<!-- SPDX-License-Identifier: MIT -->
# CodeQL dispositions - issue #30

Every open alert in `Rwanbt/unifia`, one row each, with its decision and evidence.
Lane D, 2026-10-05, against `dev@26ba494d0`. Nothing here is a dismissal: no alert
was dismissed through the API, no query weakened, no rule excluded.

## The 223 are not 223 live problems

All 223 report the same `most_recent_instance.commit_sha`,
`207ff452b8056ae11f1f71e23198e520835f70ed`. Measured:

```
git log -1 207ff452b                                  Merge pull request #16 from Rwanbt/dev
git rev-parse origin/main                             207ff452b8056ae11f1f71e23198e520835f70ed
git merge-base --is-ancestor 207ff452b origin/dev     exit 0
```

So the newest analysis producing any of them is the analysis of `main`'s head, and
`main` is an ancestor of `dev`. Every analysis since, on `dev`, finished with an
empty `error`: `1894496010` at `871e8f04`, and `1894564662` at `26ba494d0`, both
`results_count: 22`, `rules_count: 103`. GitHub has not closed the old alerts.

Which can still describe `dev` is decidable per alert by checking the anchor
against the tree:

| anchor state | alerts | meaning |
|---|---|---|
| `PATH_ABSENT` | 101 | the file is not in `dev` at all |
| `ANCHOR_GONE` | 2 | file present, the alert's line is past EOF |
| `ANCHOR_VALID` | 120 | file present and still has that line |

62 of the 101 absent paths are under `packages/opencode/`, renamed to
`packages/unifia/` by the rebrand (`91daa35a2`). Of the 46 alerts carrying a
`security_severity_level`: 29 `PATH_ABSENT`, 1 `ANCHOR_GONE`, **16 `ANCHOR_VALID`**.
Only those 16 can still describe current code, so only those 16 needed an
individual decision. All 16 are dispositioned below; the other 207 are grouped.

Correction worth recording: the first pass classified anchors with
`Measure-Object -Line`, which skips blank lines, and called four files
`ANCHOR_GONE` that are not; discarded and recomputed with `@(Get-Content).Count`.

## FIXED - 9 alerts, PR #297 (`78f9d01c`)

| alert | rule | file | fix |
|---|---|---|---|
| 14 | `js/request-forgery` (critical) | `github/index.ts:465` | `attachmentUrl()` asserts the parsed origin is `https://github.com` and the path a user attachment before any `Authorization` header is built; otherwise dropped, never fetched |
| 23 | `js/log-injection` | `github/index.ts:472` | `logSafe()` collapses `[\x00-\x1f\x7f]` to spaces, truncates at 200 chars |
| 2, 3, 4 | `js/incomplete-sanitization` (high) | `packages/console/core/script/{promote,pull,update}-models.ts` | `quoteEnvValue()` escapes backslash before quote, so a JSON value from `sst secret list` cannot close its own quoted env line early |
| 5 | `js/incomplete-sanitization` (high) | `packages/desktop-electron/src/main/apps.ts:23` | `isBundleName()` rejects an IPC-supplied `appName` that is not one plain path segment |
| 8, 35 | `js/shell-command-injection-from-environment`, `js/indirect-command-line-injection` | `scripts/bundle-mobile.mjs:67` | `execFileSync` with an argument list; no shell spawned |
| 21 | `js/identity-replacement` | `packages/console/app/src/routes/workspace/common.tsx:18` | removed `.replace(",", ",")`, which replaced a comma with itself |

Each has a regression test. The env-value test was run against the pre-fix code
and fails there (0 pass / 3 fail), so it is not a test that passes either way.

## (a) Alert 1 - `js/double-escaping`, high - FALSE POSITIVE

`packages/ui/src/context/marked.tsx:75`, *"may produce '&' characters that are
double-unescaped here."* The chain expands `&amp;` **last**:

```ts
escapedCode.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, "&")
```

That is the safe order: when an `&amp;` becomes an `&`, every `&lt;`-style
replacement has already run, so the `&` cannot be re-examined by them. Trace,
executed against the chain as written: `"&lt;" -> "<"` (intended),
`"&amp;lt;" -> "&lt;"` (**not** `"<"`), `"&amp;amp;" -> "&amp;"` (not `"&"`),
`"&amp;quot;" -> "&quot;"`, `"&amp;amp;lt;" -> "&amp;lt;"`,
`"a &lt; b &amp;&amp; c &gt; d" -> "a < b && c > d"`. Applied once per code block
inside the `for (const match of matches)` loop, so no second pass exists. The
order is the mitigation CodeQL is not crediting; reversing it would create the
very defect the rule warns about. Not changed.

## (b) Alert 20 - `js/biased-cryptographic-random`, high - FIXED AT SOURCE

`packages/util/src/identifier.ts:23`. The modulo moved into
`packages/util/src/random.ts`, which does rejection sampling and names the rule:
`const limit = BYTE_VALUES - (BYTE_VALUES % alphabet.length)`, then
`if (byte >= limit) continue` - *"dropped and redrawn instead of folded in (CodeQL
js/biased-cryptographic-random)"*. Covered by `packages/util/src/random.test.ts`.
`randomString` backs id generation and the OAuth PKCE verifiers, which is where
uniformity matters. Not changed.

## (c) Alert 26 - `js/insecure-temporary-file`, high - FIXED AT SOURCE

`packages/desktop-electron/src/main/cli.ts:86`. `withInstallScript` now does all
four things the rule asks for: `mkdtemp(join(temporaryRoot, "unifia-install-"))`,
`writeFile(path, script, { flag: "wx", mode: 0o700 })`, and
`rm(directory, { recursive: true, force: true })` in `finally`: private directory,
exclusive creation, owner-only mode, removal on the failure path. Covered by
`src/main/install-script.test.ts`. The same pattern was applied to the TUI editor
in issue #155 (alerts #389/#390, both `state: "fixed"`), and
`packages/unifia/test/cli/tui/editor.test.ts` was re-run green on this base.

## (d) Alert 278 - `js/polynomial-redos`, high - FIXED AT SOURCE

`packages/app/src/components/connect/remote-connect.tsx:20`. The regex was
`replace(/\/+$/, "")`; `trimTrailingSlashes` in `packages/app/src/utils/url.ts` is
now one backward walk. Its doc comment carries the measurement: 222 ms / 2 914 ms /
8 001 ms for `n` = 10 000 / 50 000 / 100 000 on the old regex, and 0.004 ms at every
size on the new one - *"the input length is attacker-chosen and 8 s is a frozen
WebView."* Not changed.

## (e) Alerts 16 and 17 - `js/prototype-polluting-assignment`, medium - GENERATED CODE

`packages/sdk/js/src/v2/gen/core/params.gen.ts:131,143`, emitted by
`openapi-typescript-codegen` from `packages/sdk/openapi.json`. Hand-editing
generated output is overwritten on the next sync, and the `sdk in sync with server`
required check fails CI if the tree diverges, so an edit cannot survive. The
tainted input would be a `__proto__` key arriving from the server API; the SDK is
that API's client and the server is `packages/workbench-server`, which validates
its own routes. The fix belongs in the generator template or in server-side
schema validation.

## (f) Alert 24 - `js/log-injection`, medium - DELIBERATE DIAGNOSTIC LOG

`packages/app/src/components/terminal.tsx:279` is the intentional v5 diagnostic
build, and the code says so: *"Always log (was gated on import.meta.env.DEV) ...
Revert the unconditional log once the terminal regression is resolved."* The rule
fires because `msg` is built from terminal state, which includes session strings.
Not changed for two reasons: the value is a developer's own session text going to
their own DevTools console, and the comment marks the log as temporary with an
explicit revert condition - sanitising it would extend the life of something
already scheduled for removal, so it is recorded here instead.

## (g) Alert 496 - `js/http-to-file-access`, medium - FIXED AT SOURCE

`packages/ui/vite.config.ts:56`. The file is now 32 lines; the alert anchors at line
56, which no longer exists. Build configuration, not runtime code, so recorded as
`ANCHOR_GONE` rather than claimed fixed.

---

## STALE - 103 alerts (c)

101 `PATH_ABSENT` + 2 `ANCHOR_GONE`. The most common cause is the
`packages/opencode` -> `packages/unifia` rename. Nothing to change: the code is not
in the tree and the `dev` analyses since have not reproduced it. **Not** marked
resolved in GitHub - that is a dismissal decision, and it is the owner's.

## NOT REPRODUCED - 104 alerts (d)

Anchor valid in `dev`, but the two latest `dev` analyses completed with an empty
error and 22 results each without reporting them. Nearly all are quality rules
with no `security_severity_level`: 98 x `js/unused-local-variable`, 37 x
`js/trivial-conditional`, 21 x `js/property-access-on-non-object`, plus a tail of
`js/useless-expression`, `js/use-before-declaration`, `js/call-to-non-callable`,
`js/comparison-between-incompatible-types`, `js/unneeded-defensive-code`,
`js/useless-comparison-test`, `js/useless-assignment-to-local`. Two shapes recur,
both framework contracts rather than defects: an unused first parameter in a route
component SolidStart supplies, and a JSX ternary whose branches are the same
expression under a Solid `Show`. Neither is a security finding, and neither is
changed here - the real dead code among them belongs to a cleanup card.

The honest limit: "the current analysis does not report it" is a statement about
the query on that commit, not proof the code is right. Recorded as exactly that.

## Reproduce

`gh api "repos/Rwanbt/unifia/code-scanning/alerts?state=open&per_page=100&page=N"` for N=1..3,
`gh api "repos/Rwanbt/unifia/code-scanning/analyses?per_page=5"`, then `git log -1 207ff452b`,
`git rev-parse origin/main` and `git merge-base --is-ancestor 207ff452b origin/dev`.
Issue #155 is closed separately on the `7a9a3569f` evidence; #30 covers the rest.

---

## Full inventory ??? all 223 open alerts

`ANCHOR_VALID` with a FIXED or DISPOSITION row means the alert can still describe `dev` and
received an individual decision. Everything else is grouped above.

| alert | sev | rule | location in the analysed commit | anchor on dev | decision |
|---|---|---|---|---|---|
| 1 | high | `js/double-escaping` | `packages/ui/src/context/marked.tsx:75` | ANCHOR_VALID | DISPOSITION (a) |
| 2 | high | `js/incomplete-sanitization` | `packages/console/core/script/promote-models.ts:32` | ANCHOR_VALID | **FIXED** #297 |
| 3 | high | `js/incomplete-sanitization` | `packages/console/core/script/pull-models.ts:32` | ANCHOR_VALID | **FIXED** #297 |
| 4 | high | `js/incomplete-sanitization` | `packages/console/core/script/update-models.ts:42` | ANCHOR_VALID | **FIXED** #297 |
| 5 | high | `js/incomplete-sanitization` | `packages/desktop-electron/src/main/apps.ts:23` | ANCHOR_VALID | **FIXED** #297 |
| 6 | high | `js/incomplete-sanitization` | `packages/opencode/src/cli/cmd/run.ts:313` | PATH_ABSENT | STALE (c) |
| 7 | medium | `js/shell-command-injection-from-environment` | `packages/opencode/src/util/process.ts:63` | PATH_ABSENT | STALE (c) |
| 8 | medium | `js/shell-command-injection-from-environment` | `scripts/bundle-mobile.mjs:67` | ANCHOR_VALID | **FIXED** #297 |
| 9 | critical | `js/command-line-injection` | `packages/opencode/src/util/process.ts:63` | PATH_ABSENT | STALE (c) |
| 10 | critical | `js/command-line-injection` | `packages/opencode/src/util/process.ts:63` | PATH_ABSENT | STALE (c) |
| 11 | medium | `js/stack-trace-exposure` | `packages/opencode/test/lib/mock-keychain-server.ts:138` | PATH_ABSENT | STALE (c) |
| 12 | high | `js/incomplete-url-substring-sanitization` | `packages/opencode/test/auth/auth.test.ts:29` | PATH_ABSENT | STALE (c) |
| 14 | critical | `js/request-forgery` | `github/index.ts:465` | ANCHOR_VALID | **FIXED** #297 |
| 16 | medium | `js/prototype-polluting-assignment` | `packages/sdk/js/src/v2/gen/core/params.gen.ts:131` | ANCHOR_VALID | DISPOSITION (e) |
| 17 | medium | `js/prototype-polluting-assignment` | `packages/sdk/js/src/v2/gen/core/params.gen.ts:143` | ANCHOR_VALID | DISPOSITION (e) |
| 18 | high | `js/biased-cryptographic-random` | `packages/opencode/src/id/id.ts:52` | PATH_ABSENT | STALE (c) |
| 19 | high | `js/biased-cryptographic-random` | `packages/opencode/src/plugin/codex.ts:34` | PATH_ABSENT | STALE (c) |
| 20 | high | `js/biased-cryptographic-random` | `packages/util/src/identifier.ts:23` | ANCHOR_VALID | DISPOSITION (b) |
| 21 | medium | `js/identity-replacement` | `packages/console/app/src/routes/workspace/common.tsx:18` | ANCHOR_VALID | **FIXED** #297 |
| 22 | medium | `js/file-access-to-http` | `packages/opencode/src/auth/index.ts:219` | PATH_ABSENT | STALE (c) |
| 23 | medium | `js/log-injection` | `github/index.ts:472` | ANCHOR_VALID | **FIXED** #297 |
| 24 | medium | `js/log-injection` | `packages/app/src/components/terminal.tsx:279` | ANCHOR_VALID | DISPOSITION (f) |
| 26 | high | `js/insecure-temporary-file` | `packages/desktop-electron/src/main/cli.ts:86` | ANCHOR_VALID | DISPOSITION (c) |
| 27 | high | `js/insecure-temporary-file` | `packages/opencode/src/local-llm-server/index.ts:283` | PATH_ABSENT | STALE (c) |
| 28 | high | `js/insecure-temporary-file` | `packages/opencode/src/local-llm-server/index.ts:347` | PATH_ABSENT | STALE (c) |
| 29 | high | `js/insecure-temporary-file` | `packages/opencode/src/local-llm-server/index.ts:429` | PATH_ABSENT | STALE (c) |
| 30 | high | `js/insecure-temporary-file` | `packages/opencode/src/local-llm-server/index.ts:535` | PATH_ABSENT | STALE (c) |
| 31 | high | `js/insecure-temporary-file` | `packages/opencode/src/util/filesystem.ts:66` | PATH_ABSENT | STALE (c) |
| 32 | high | `js/insecure-temporary-file` | `packages/opencode/src/util/filesystem.ts:74` | PATH_ABSENT | STALE (c) |
| 33 | high | `js/insecure-temporary-file` | `packages/opencode/test/preload.ts:77` | PATH_ABSENT | STALE (c) |
| 34 | medium | `js/indirect-command-line-injection` | `packages/opencode/src/util/process.ts:63` | PATH_ABSENT | STALE (c) |
| 35 | medium | `js/indirect-command-line-injection` | `scripts/bundle-mobile.mjs:67` | ANCHOR_VALID | **FIXED** #297 |
| 36 | medium | `js/http-to-file-access` | `packages/opencode/src/util/filesystem.ts:64` | PATH_ABSENT | STALE (c) |
| 37 | medium | `js/http-to-file-access` | `packages/opencode/src/util/filesystem.ts:66` | PATH_ABSENT | STALE (c) |
| 38 | medium | `js/http-to-file-access` | `packages/opencode/src/util/filesystem.ts:72` | PATH_ABSENT | STALE (c) |
| 39 | medium | `js/http-to-file-access` | `packages/opencode/src/util/filesystem.ts:74` | PATH_ABSENT | STALE (c) |
| 40 | medium | `js/http-to-file-access` | `packages/opencode/src/util/log.ts:72` | PATH_ABSENT | STALE (c) |
| 41 | high | `js/file-system-race` | `packages/opencode/src/mobile-entry.ts:80` | PATH_ABSENT | STALE (c) |
| 42 | high | `js/file-system-race` | `packages/opencode/src/session/project-context.ts:109` | PATH_ABSENT | STALE (c) |
| 43 | high | `js/file-system-race` | `packages/opencode/src/tool/apply_patch.ts:100` | PATH_ABSENT | STALE (c) |
| 44 | high | `js/file-system-race` | `packages/opencode/test/util/filesystem.test.ts:529` | PATH_ABSENT | STALE (c) |
| 45 | - | `js/unused-local-variable` | `infra/enterprise.ts:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 46 | - | `js/unused-local-variable` | `infra/enterprise.ts:6` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 47 | - | `js/unused-local-variable` | `packages/app/e2e/actions.ts:13` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 48 | - | `js/unused-local-variable` | `packages/app/e2e/models/models-visibility.spec.ts:3` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 49 | - | `js/unused-local-variable` | `packages/app/e2e/session/session-model-persistence.spec.ts:35` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 50 | - | `js/unused-local-variable` | `packages/app/e2e/session/session-review.spec.ts:1` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 51 | - | `js/unused-local-variable` | `packages/app/e2e/session/session-model-persistence.spec.ts:159` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 52 | - | `js/unused-local-variable` | `packages/app/e2e/sidebar/sidebar-session-links.spec.ts:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 72 | - | `js/unused-local-variable` | `packages/app/test/e2e/mock.test.ts:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 73 | - | `js/unused-local-variable` | `packages/console/app/script/generate-sitemap.ts:11` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 74 | - | `js/unused-local-variable` | `packages/console/app/src/component/email-signup.tsx:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 75 | - | `js/unused-local-variable` | `packages/console/app/src/routes/bench/[id].tsx:4` | PATH_ABSENT | STALE (c) |
| 76 | - | `js/unused-local-variable` | `packages/console/app/src/routes/go/index.tsx:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 77 | - | `js/unused-local-variable` | `packages/console/app/src/routes/index.tsx:34` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 78 | - | `js/unused-local-variable` | `packages/console/app/src/routes/user-menu.tsx:10` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 79 | - | `js/unused-local-variable` | `packages/console/app/src/routes/workspace-picker.tsx:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 80 | - | `js/unused-local-variable` | `packages/console/app/src/routes/zen/index.tsx:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 81 | - | `js/unused-local-variable` | `packages/console/core/script/black-onboard-waitlist.ts:1` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 82 | - | `js/unused-local-variable` | `packages/console/core/script/black-onboard-waitlist.ts:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 83 | - | `js/unused-local-variable` | `packages/console/core/script/black-onboard-waitlist.ts:3` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 84 | - | `js/unused-local-variable` | `packages/console/core/script/black-onboard-waitlist.ts:4` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 85 | - | `js/unused-local-variable` | `packages/console/core/script/black-cancel-waitlist.ts:1` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 86 | - | `js/unused-local-variable` | `packages/console/core/script/black-cancel-waitlist.ts:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 87 | - | `js/unused-local-variable` | `packages/console/core/script/black-cancel-waitlist.ts:3` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 88 | - | `js/unused-local-variable` | `packages/console/core/script/black-cancel-waitlist.ts:4` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 89 | - | `js/unused-local-variable` | `packages/console/core/script/black-gift.ts:2` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 90 | - | `js/unused-local-variable` | `packages/console/core/script/black-gift.ts:4` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 91 | - | `js/unused-local-variable` | `packages/console/core/script/black-gift.ts:6` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 92 | - | `js/unused-local-variable` | `packages/console/core/script/black-select-workspaces.ts:1` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 93 | - | `js/unused-local-variable` | `packages/console/core/script/black-gift.ts:9` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 94 | - | `js/unused-local-variable` | `packages/enterprise/test/core/share.test.ts:1` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 95 | - | `js/unused-local-variable` | `packages/function/src/api.ts:15` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 96 | - | `js/unused-local-variable` | `packages/mobile/src/components/mode-selector.tsx:1` | PATH_ABSENT | STALE (c) |
| 97 | - | `js/unused-local-variable` | `packages/function/src/api.ts:198` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 98 | - | `js/unused-local-variable` | `packages/opencode/script/postinstall.mjs:88` | PATH_ABSENT | STALE (c) |
| 109 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/app.tsx:58` | PATH_ABSENT | STALE (c) |
| 110 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx:5` | PATH_ABSENT | STALE (c) |
| 111 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx:22` | PATH_ABSENT | STALE (c) |
| 112 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/component/dialog-theme-list.tsx:4` | PATH_ABSENT | STALE (c) |
| 113 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx:114` | PATH_ABSENT | STALE (c) |
| 114 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/component/workspace/dialog-session-list.tsx:5` | PATH_ABSENT | STALE (c) |
| 115 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/component/workspace/dialog-session-list.tsx:23` | PATH_ABSENT | STALE (c) |
| 116 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:1` | PATH_ABSENT | STALE (c) |
| 118 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx:604` | PATH_ABSENT | STALE (c) |
| 119 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/routes/session/subagent-footer.tsx:62` | PATH_ABSENT | STALE (c) |
| 120 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/ui/dialog-select.tsx:3` | PATH_ABSENT | STALE (c) |
| 121 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:91` | PATH_ABSENT | STALE (c) |
| 122 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:94` | PATH_ABSENT | STALE (c) |
| 123 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:94` | PATH_ABSENT | STALE (c) |
| 162 | - | `js/unused-local-variable` | `packages/opencode/test/cli/tui/plugin-lifecycle.test.ts:8` | PATH_ABSENT | STALE (c) |
| 163 | - | `js/unused-local-variable` | `packages/opencode/test/effect/cross-spawn-spawner.test.ts:1` | PATH_ABSENT | STALE (c) |
| 164 | - | `js/unused-local-variable` | `packages/opencode/test/effect/cross-spawn-spawner.test.ts:5` | PATH_ABSENT | STALE (c) |
| 165 | - | `js/unused-local-variable` | `packages/opencode/test/effect/instance-state.test.ts:2` | PATH_ABSENT | STALE (c) |
| 166 | - | `js/unused-local-variable` | `packages/opencode/test/effect/runner.test.ts:415` | PATH_ABSENT | STALE (c) |
| 167 | - | `js/unused-local-variable` | `packages/opencode/test/file/index.test.ts:272` | PATH_ABSENT | STALE (c) |
| 168 | - | `js/unused-local-variable` | `packages/opencode/test/fixture/lsp/fake-lsp-server.js:4` | PATH_ABSENT | STALE (c) |
| 169 | - | `js/unused-local-variable` | `packages/opencode/test/lib/llm-server.ts:600` | PATH_ABSENT | STALE (c) |
| 170 | - | `js/unused-local-variable` | `packages/opencode/test/lib/llm-server.ts:619` | PATH_ABSENT | STALE (c) |
| 171 | - | `js/unused-local-variable` | `packages/opencode/test/plugin/loader-shared.test.ts:21` | PATH_ABSENT | STALE (c) |
| 172 | - | `js/unused-local-variable` | `packages/opencode/test/plugin/loader-shared.test.ts:23` | PATH_ABSENT | STALE (c) |
| 173 | - | `js/unused-local-variable` | `packages/opencode/test/project/project.test.ts:11` | PATH_ABSENT | STALE (c) |
| 174 | - | `js/unused-local-variable` | `packages/opencode/test/pty/android-pty.test.ts:1` | PATH_ABSENT | STALE (c) |
| 175 | - | `js/unused-local-variable` | `packages/opencode/test/pty/android-pty.test.ts:18` | PATH_ABSENT | STALE (c) |
| 176 | - | `js/unused-local-variable` | `packages/opencode/test/pty/android-pty.test.ts:19` | PATH_ABSENT | STALE (c) |
| 177 | - | `js/unused-local-variable` | `packages/opencode/test/server/broadcast.test.ts:1` | PATH_ABSENT | STALE (c) |
| 178 | - | `js/unused-local-variable` | `packages/opencode/test/provider/transform.test.ts:5` | PATH_ABSENT | STALE (c) |
| 179 | - | `js/unused-local-variable` | `packages/opencode/test/server/session-list.test.ts:58` | PATH_ABSENT | STALE (c) |
| 180 | - | `js/unused-local-variable` | `packages/opencode/test/session/llm.test.ts:295` | PATH_ABSENT | STALE (c) |
| 181 | - | `js/unused-local-variable` | `packages/opencode/test/session/llm.test.ts:886` | PATH_ABSENT | STALE (c) |
| 182 | - | `js/unused-local-variable` | `packages/opencode/test/session/llm.test.ts:1005` | PATH_ABSENT | STALE (c) |
| 183 | - | `js/unused-local-variable` | `packages/opencode/test/session/messages-pagination.test.ts:707` | PATH_ABSENT | STALE (c) |
| 184 | - | `js/unused-local-variable` | `packages/opencode/test/session/messages-pagination.test.ts:731` | PATH_ABSENT | STALE (c) |
| 185 | - | `js/unused-local-variable` | `packages/opencode/test/session/messages-pagination.test.ts:753` | PATH_ABSENT | STALE (c) |
| 186 | - | `js/unused-local-variable` | `packages/opencode/test/session/messages-pagination.test.ts:875` | PATH_ABSENT | STALE (c) |
| 187 | - | `js/unused-local-variable` | `packages/opencode/test/session/revert-compact.test.ts:1` | PATH_ABSENT | STALE (c) |
| 188 | - | `js/unused-local-variable` | `packages/opencode/test/session/revert-compact.test.ts:7` | PATH_ABSENT | STALE (c) |
| 189 | - | `js/unused-local-variable` | `packages/opencode/test/session/snapshot-tool-race.test.ts:49` | PATH_ABSENT | STALE (c) |
| 190 | - | `js/unused-local-variable` | `packages/opencode/test/session/revert-compact.test.ts:364` | PATH_ABSENT | STALE (c) |
| 191 | - | `js/unused-local-variable` | `packages/opencode/test/tool/edit.test.ts:88` | PATH_ABSENT | STALE (c) |
| 192 | - | `js/unused-local-variable` | `packages/opencode/test/tool/question.test.ts:3` | PATH_ABSENT | STALE (c) |
| 193 | - | `js/unused-local-variable` | `packages/opencode/test/tool/skill.test.ts:52` | PATH_ABSENT | STALE (c) |
| 194 | - | `js/unused-local-variable` | `packages/slack/src/index.ts:30` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 200 | - | `js/unused-local-variable` | `script/publish.ts:7` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 201 | - | `js/unused-local-variable` | `sdks/vscode/src/extension.ts:9` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 204 | - | `js/useless-assignment-to-local` | `packages/opencode/src/tool/apply_patch.ts:101` | PATH_ABSENT | STALE (c) |
| 205 | - | `js/useless-assignment-to-local` | `packages/opencode/src/tool/webfetch.ts:43` | PATH_ABSENT | STALE (c) |
| 206 | - | `js/use-before-declaration` | `packages/desktop/scripts/finalize-latest-json.ts:6` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 207 | - | `js/use-before-declaration` | `packages/desktop-electron/src/main/index.ts:24` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 208 | - | `js/superfluous-trailing-arguments` | `packages/desktop-electron/scripts/predev.ts:17` | ANCHOR_GONE | STALE (c) |
| 212 | - | `js/useless-comparison-test` | `packages/ui/src/components/scroll-view.tsx:87` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 213 | - | `js/trivial-conditional` | `packages/app/src/components/mobile/message-input.tsx:22` | PATH_ABSENT | STALE (c) |
| 214 | - | `js/trivial-conditional` | `packages/app/src/components/mobile/message-input.tsx:38` | PATH_ABSENT | STALE (c) |
| 215 | - | `js/trivial-conditional` | `packages/app/src/components/server/server-row.tsx:36` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 216 | - | `js/trivial-conditional` | `packages/app/src/components/server/server-row.tsx:37` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 217 | - | `js/trivial-conditional` | `packages/app/src/components/session/session-sortable-terminal-tab.tsx:100` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 218 | - | `js/trivial-conditional` | `packages/console/app/src/component/spotlight.tsx:469` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 219 | - | `js/trivial-conditional` | `packages/console/app/src/component/spotlight.tsx:489` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 220 | - | `js/trivial-conditional` | `packages/console/app/src/component/spotlight.tsx:499` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 221 | - | `js/trivial-conditional` | `packages/console/app/src/component/spotlight.tsx:650` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 222 | - | `js/trivial-conditional` | `packages/console/app/src/component/spotlight.tsx:780` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 223 | - | `js/trivial-conditional` | `packages/console/app/src/routes/black/workspace.tsx:55` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 224 | - | `js/trivial-conditional` | `packages/console/app/src/routes/workspace-picker.tsx:69` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 225 | - | `js/trivial-conditional` | `packages/console/app/src/routes/workspace/[id]/usage/graph-section.tsx:424` | PATH_ABSENT | STALE (c) |
| 226 | - | `js/trivial-conditional` | `packages/desktop/src/hooks/use-speech.ts:349` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 227 | - | `js/trivial-conditional` | `packages/mobile/src/hooks/use-speech.ts:279` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 228 | - | `js/trivial-conditional` | `packages/mobile/src/hooks/use-speech.ts:281` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 229 | - | `js/trivial-conditional` | `packages/opencode/src/cli/cmd/import.ts:150` | PATH_ABSENT | STALE (c) |
| 230 | - | `js/trivial-conditional` | `packages/opencode/src/cli/cmd/tui/context/keybind.tsx:45` | PATH_ABSENT | STALE (c) |
| 231 | - | `js/trivial-conditional` | `packages/opencode/src/session/revert.ts:59` | PATH_ABSENT | STALE (c) |
| 232 | - | `js/trivial-conditional` | `packages/opencode/src/session/system.ts:60` | PATH_ABSENT | STALE (c) |
| 233 | - | `js/trivial-conditional` | `packages/opencode/src/storage/storage.ts:111` | PATH_ABSENT | STALE (c) |
| 234 | - | `js/trivial-conditional` | `packages/ui/src/components/basic-tool.tsx:95` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 235 | - | `js/trivial-conditional` | `packages/ui/src/components/basic-tool.tsx:101` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 236 | - | `js/trivial-conditional` | `packages/ui/src/components/scroll-view.tsx:67` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 237 | - | `js/trivial-conditional` | `packages/ui/src/components/shell-submessage-motion.stories.tsx:109` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 238 | - | `js/trivial-conditional` | `packages/ui/src/components/message-part.tsx:65` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 239 | - | `js/trivial-conditional` | `packages/ui/src/components/message-part.tsx:68` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 240 | - | `js/trivial-conditional` | `packages/ui/src/components/text-strikethrough.tsx:32` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 241 | - | `js/trivial-conditional` | `packages/ui/src/components/text-strikethrough.tsx:33` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 242 | - | `js/trivial-conditional` | `packages/ui/src/components/text-strikethrough.stories.tsx:143` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 243 | - | `js/trivial-conditional` | `packages/ui/src/components/text-strikethrough.stories.tsx:144` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 245 | - | `js/trivial-conditional` | `packages/ui/src/components/tooltip.tsx:57` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 246 | - | `js/trivial-conditional` | `packages/ui/src/components/tooltip.tsx:90` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 247 | - | `js/trivial-conditional` | `packages/ui/src/components/timeline-playground.stories.tsx:1173` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 248 | - | `js/trivial-conditional` | `packages/ui/src/components/timeline-playground.stories.tsx:1187` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 249 | - | `js/comparison-between-incompatible-types` | `packages/app/src/pages/error.tsx:32` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 250 | - | `js/missing-await` | `packages/opencode/src/security/dlp.ts:152` | PATH_ABSENT | STALE (c) |
| 251 | - | `js/unneeded-defensive-code` | `packages/console/app/src/component/dropdown.tsx:29` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 252 | - | `js/useless-expression` | `packages/app/src/components/status-popover-body.tsx:99` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 253 | - | `js/useless-expression` | `packages/app/src/pages/session/review-tab.tsx:120` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 254 | - | `js/useless-expression` | `packages/console/app/src/routes/workspace/[id]/usage/graph-section.tsx:212` | PATH_ABSENT | STALE (c) |
| 255 | - | `js/useless-expression` | `packages/ui/src/hooks/create-auto-scroll.tsx:210` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 256 | - | `js/call-to-non-callable` | `packages/app/test/e2e/mock.test.ts:10` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 257 | - | `js/call-to-non-callable` | `packages/ui/src/components/toast.stories.tsx:107` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 258 | - | `js/property-access-on-non-object` | `packages/app/src/components/terminal.tsx:443` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 259 | - | `js/property-access-on-non-object` | `packages/app/src/components/terminal.tsx:575` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 260 | - | `js/property-access-on-non-object` | `packages/app/src/pages/session/composer/session-todo-dock.tsx:92` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 261 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:101` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 262 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:114` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 263 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:116` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 264 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:126` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 265 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:132` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 266 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:133` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 267 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:134` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 268 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:137` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 269 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:138` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 270 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:154` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 271 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:160` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 272 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:164` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 273 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:168` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 274 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:172` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 275 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:172` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 276 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:176` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 277 | - | `js/property-access-on-non-object` | `packages/ui/src/components/scroll-view.tsx:180` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 278 | high | `js/polynomial-redos` | `packages/app/src/components/connect/remote-connect.tsx:20` | ANCHOR_VALID | DISPOSITION (d) |
| 280 | critical | `js/command-line-injection` | `packages/opencode/script/cargo-proxy.mjs:117` | PATH_ABSENT | STALE (c) |
| 282 | - | `js/unused-local-variable` | `packages/opencode/script/cargo-proxy.mjs:24` | PATH_ABSENT | STALE (c) |
| 283 | - | `js/useless-assignment-to-local` | `packages/app/src/pages/session/session-history-window.ts:122` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 285 | - | `js/trivial-conditional` | `packages/app/src/pages/session/session-side-panel.tsx:464` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 286 | - | `js/regex/duplicate-in-character-class` | `packages/opencode/src/pty/index.ts:166` | PATH_ABSENT | STALE (c) |
| 287 | - | `js/regex/duplicate-in-character-class` | `packages/opencode/src/pty/index.ts:166` | PATH_ABSENT | STALE (c) |
| 288 | - | `js/regex/duplicate-in-character-class` | `packages/opencode/src/pty/index.ts:166` | PATH_ABSENT | STALE (c) |
| 289 | - | `js/unused-local-variable` | `packages/opencode/test/server/git-routes.test.ts:13` | PATH_ABSENT | STALE (c) |
| 290 | - | `js/property-access-on-non-object` | `packages/ui/src/components/code-mirror.tsx:228` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 301 | - | `js/unused-local-variable` | `packages/app/scripts/runtime-smoke.ts:15` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 302 | - | `js/unused-local-variable` | `packages/app/scripts/runtime-smoke.ts:16` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 303 | - | `js/unused-local-variable` | `packages/app/scripts/runtime-smoke.ts:42` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 304 | - | `js/unused-local-variable` | `packages/app/scripts/runtime-smoke.ts:43` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 305 | - | `js/unused-local-variable` | `packages/app/scripts/runtime-smoke.ts:124` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 315 | - | `js/useless-assignment-to-local` | `packages/opencode/src/config/tui.ts:73` | PATH_ABSENT | STALE (c) |
| 316 | - | `js/useless-assignment-to-local` | `packages/opencode/src/collective/orchestrator.ts:402` | PATH_ABSENT | STALE (c) |
| 317 | - | `js/trivial-conditional` | `packages/app/src/components/todo-panel-motion.stories.tsx:195` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 322 | critical | `js/request-forgery` | `packages/opencode/src/cli/cmd/github-run.ts:581` | PATH_ABSENT | STALE (c) |
| 323 | medium | `js/log-injection` | `packages/opencode/src/cli/cmd/github-run.ts:593` | PATH_ABSENT | STALE (c) |
| 324 | - | `js/unused-local-variable` | `packages/opencode/src/cli/cmd/tui/component/dialog-debate-setup.tsx:53` | PATH_ABSENT | STALE (c) |
| 326 | - | `js/unused-local-variable` | `packages/app/src/components/settings-observability-cost.tsx:5` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 327 | - | `js/unused-local-variable` | `packages/app/src/components/settings-observability.tsx:100` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 328 | - | `js/unused-local-variable` | `packages/app/src/components/settings-observability.tsx:102` | ANCHOR_VALID | NOT REPRODUCED (d) |
| 329 | - | `js/unused-local-variable` | `packages/opencode/src/tool/task.ts:415` | PATH_ABSENT | STALE (c) |
| 330 | - | `js/unused-local-variable` | `packages/opencode/test/session/prompt-cache.test.ts:19` | PATH_ABSENT | STALE (c) |
| 331 | - | `js/unused-local-variable` | `packages/opencode/src/collective/orchestrator.ts:8` | PATH_ABSENT | STALE (c) |
| 496 | medium | `js/http-to-file-access` | `packages/ui/vite.config.ts:56` | ANCHOR_GONE | DISPOSITION (g) |
