<!-- SPDX-License-Identifier: MIT -->
# Dependency acceptances - issue #33

Every advisory `bun audit` still reports on `dev`, and why it is still reported.
Lane D, refreshed on 2026-10-06 against `dev@66b6071df`, with `bun 1.3.14`.

```
bun audit -> 8 vulnerabilities (1 high, 5 moderate, 2 low)
```

**Zero critical. One high.** That high has no patched version published; the
reasoning and the mitigation are in section 1. Everything else is either fixed or
accepted below.

## 2026-10-06 continuation - the two "fixable on request" entries are now closed

The previous revision left sections 6 and 7 explicitly open, with the note that they
were "fixable now and listed as such rather than accepted". That left neither a fix
nor an acceptance, which is the one state this file is not allowed to have. Both are
now resolved, in opposite ways, and each is justified by measurement rather than by
preference.

| # | advisory | outcome |
|---|---|---|
| 6 | `smol-toml` | **FIXED** - override to 1.9.0, PR #360 |
| 7 | `postcss-selector-parser` | **ACCEPTED** - no compatible patched version exists; see the rewritten section 7 |

After #360, on `dev`:

```
bun audit -> 7 vulnerabilities (1 high, 4 moderate, 2 low)
```

## Read the totals with a timestamp

The first measurement this lane took, at **2026-10-05T15:45Z on `dev@56ad2a2ad`**,
was **5 vulnerabilities (2 high, 2 moderate, 1 low)**. The same lockfile, hours
later, reports 12. Nothing about the dependency graph moved; the **advisory feed
did**. Confirmed against the advisory database rather than assumed:

| advisory | package | published |
|---|---|---|
| GHSA-jqcg-44mw-7w3h | `proxy-addr` | 2026-10-05T23:30:26Z |
| GHSA-jp82-f5mq-hwhp | `seroval` | 2026-10-05T23:40:40Z |
| GHSA-238p-pmpm-9mq7 | `katex` | 2026-10-05T23:41:05Z |

All three were published about **eight hours after** the 15:45Z measurement. So an
absolute advisory count is not a stable baseline for a gate, and any gate written as
one needs the timestamp attached to it. This file is a snapshot, not a standing
promise.

## Fixed by this lane

| advisory | severity | package | PR | merge |
|---|---|---|---|---|
| GHSA-ch52-4w7c-c8xp | high | `http-cache-semantics <=4.2.0` | #304 | `e3aa2f3da` |
| GHSA-jqcg-44mw-7w3h | critical | `proxy-addr <2.0.8` | #329 | `23ea34e78` |
| GHSA-jp82-f5mq-hwhp + pair | critical + high | `seroval <=1.6.0` | #330 | `692a24218` |
| GHSA-68fv-2mgg-jv7q | high | `source-map-js <1.2.2` | #331 | `66b6071df` |

Each was a bump inside a range the consumer already declares, checked with
`bun why`:

```
astro             requires ^4.2.0          → http-cache-semantics 4.3.0
express           requires ^2.0.7          → proxy-addr 2.0.8
@solidjs/start    requires ^1.5.4 / ^1.2.1  → seroval 1.6.8, source-map-js 1.2.2
```

Nothing was forced outside a declared range, which is the trap this repository
has already been caught by once - the root `overrides` block still carries
`"@ai-sdk/provider-utils": "4.0.56"` for exactly that reason.

---

## 1. `braces` - HIGH, no patched version exists. ACCEPTED by the owner on 2026-10-07.

`GHSA-vfj7-8cjw-p6xm`, range `<= 3.0.3`.

**There is nothing to bump to.** `npm view braces version` is `3.0.3`: the newest
published version, and the advisory range includes it. The set of non-vulnerable
versions is empty. An override would have to point at a version that does not
exist or at a fork.

Re-verified against the registry on 2026-10-06, and the escape route upward is
closed too:

```
$ npm view braces version      ->  3.0.3
$ npm view braces versions     ->  ... "2.3.0", "2.3.1", "2.3.2", "3.0.0",
                                    "3.0.1", "3.0.2", "3.0.3"   <- list ends here
$ npm view micromatch version  ->  4.0.8
```

`3.0.3` is not merely the current `latest` tag, it is the **highest version ever
published** - there is no later release to move to. And the single parent that
pulls it in is already at its own ceiling: `micromatch@4.0.8` is the newest
`micromatch`, and it requires `braces ^3.0.3`. So this cannot be escaped by
bumping `braces` *or* by bumping the package above it. Every other consumer in
the tree (`@solidjs/start`, `tailwindcss`, `@jsx-email/cli`, `chokidar`) reaches
the same `micromatch` rather than an independent copy.

**Who reaches it, and whether an attacker can supply the pattern.** `bun why
braces` puts one path in shipped code:

```
braces@3.0.3 → micromatch@4.0.8 → @parcel/watcher@2.5.1 → unifia
```

`packages/unifia/src/file/watcher.ts:3` imports `@parcel/watcher/wrapper`, whose
`wrapper.js:17` calls `micromatch.makeRe(value)` on **every ignore pattern**.
`packages/unifia/src/config/config.ts:707-713` merges project config files found by
walking up from the working directory unless `UNIFIA_DISABLE_PROJECT_CONFIG` is
set. So a **cloned repository can put a pattern into `watcher.ignore`**, and this
is not a "build-time only, developer-controlled input" advisory.

**What it costs, measured rather than assumed.** The advisory says stack
exhaustion; the installed version does something else:

| nested braces | `micromatch.makeRe` |
|---|---|
| 1 000 | 46 ms |
| 5 000 | 783 ms |
| 20 000 | **12 731 ms** |
| 100 000 | `SyntaxError`, V8's own 65536-char regex ceiling |

Superlinear compile cost, not a stack overflow, but a denial of service in
substance: 12.7 s on the watcher-init path, with a hard stop only once the pattern
is large enough to trip V8. Combinatorial shapes (`{a,b}` repeated) were probed
and are cheap - 30 repetitions under a millisecond.

**Mitigated at the product boundary** in #309, because the reachability is real and
the upstream fix is not:

- `FileIgnore.MAX_BRACE_DEPTH = 32`, with `isPathologicalPattern()` and
  `boundPatterns()`.
- `FileWatcher` applies it to `cfg.watcher.ignore` and logs every pattern it
  drops, because a dropped ignore pattern means watching *more* than asked.
- `test/file/ignore-glob-depth.test.ts` pins the behaviour and asserts the
  product's own `PATTERNS` is unaffected.

32 is far above any real ignore pattern; the product's own list never nests.

**ACCEPTED, 2026-10-07.** This bound does not change what `bun audit` reports,
only whether the finding is exploitable. The owner accepted releasing with this
standing high advisory on that basis: the exposure is a denial of service
through a pattern the product itself never nests deeper than the bound, and no
patched version exists to move to. `bun audit` will keep listing it. Re-check
whenever `braces` publishes: `npm view braces version` is the test that retires
this section.

**Expires 2026-11-07.** After that date this acceptance is void until it is
reviewed again. At review, re-run `npm view braces version`, run
`test/file/ignore-glob-depth.test.ts` (8 tests, passing on `dev` 2026-10-10), and
renew with the new date or remove the section.

**Reachability re-checked 2026-10-10.** The path is `watcher.ignore` from a project
config found by walking up from the working directory (`config/config.ts`), into
`@parcel/watcher`'s wrapper (`micromatch.makeRe` per pattern). The bound in
`file/ignore.ts` and `file/watcher.ts` is applied on that path; no other glob sink
in the server compiles an untrusted pattern through `braces` (`util/glob.ts` uses
`minimatch`, a different package, patched at 10.2.5).

---

## 2 & 3. `react-router` - MODERATE x2, accepted

`GHSA-wrjc-x8rr-h8h6` (open redirect via backslash in `<Link>` and
`useNavigate`, `>= 6.0.0, < 7.18.0`) and `GHSA-337j-9hxr-rhxg` (constructor
injection via `deserializeErrors()` in SSR hydration, `>= 6.4.0, < 7.18.0`). Both
name **7.18.0**. Single path:

```
@unifia/console-mail › @jsx-email/cli@1.4.3 › react-router-dom@6.16.0 › react-router@6.30.4
```

**The fix is a major bump onto a tool pinned to 6.x.** `@jsx-email/cli@1.4.3`
declares `react-router-dom: 6.16.0` and `react: 18.2.0`. Forcing
`react-router >= 7.18.0` is the major-version override this repository has already
been bitten by; trading a moderate, dev-only advisory for a build that may not
resolve is a bad trade.

**Neither advisory's code path exists in a Unifia runtime.** The console is
SolidJS on `@solidjs/start`, not React Router: `deserializeErrors()` is a React
Router *SSR hydration* entry point and there is no React Router SSR in this
deployment. The open-redirect advisory needs a user-supplied redirect target
reaching `<Link>` or `useNavigate`; `packages/console/app` has no React Router
route tree at all. The code executes only inside the `email` CLI's local
template-preview server, a developer tool started by hand.

**Residual.** `@unifia/console-mail` is a *production* dependency of both
`@unifia/console-app` and `@unifia/console-core`, and the CLI ships inside it. A
future change rendering console email through that tool in a served context would
invalidate this acceptance.

---

## 4. `aws-sdk` - LOW, accepted

`GHSA-j965-2qgj-vjmq`: SDK v2 users should validate the `region` parameter or
migrate to v3. Range `>= 2.0.0, <= 3.0.0`, `first_patched_version: null` - a
migration notice, not memory unsafety or RCE.

Single path: `sst@3.18.10 › aws-sdk@2.1692.0`. `sst` is a **root devDependency**,
the SST CLI used for local dev and infra definitions. The region values come from
`sst.config.ts` or the developer's own shell - the person running the command
already has full local authority. Nothing here constructs an AWS SDK v2 client
with a request-derived region. The fix is migrating `sst`, which is `sst`'s
release schedule, not this repository's.

---

## 5. `sprintf-js` - MODERATE, accepted: same shape as `braces`

`GHSA-hp3w-g68c-fv3c`, range `<= 1.1.3`. `npm view sprintf-js version` is
`1.1.3`. The latest published version is itself the top of the vulnerable range, so
like `braces` there is nothing to bump to. Reached only through `electron` and
`electron-builder`, which are dev dependencies of `@unifia/desktop-electron` and
run at build time on patterns the developer controls. Accepted for that reason,
with the same caveat as `braces`: if a patched version appears, bump it.

## 6. `smol-toml` - MODERATE, FIXED by override to 1.9.0

`GHSA-r4xh-jqrq-34v2`, quadratic `parse()` from `parseKey`, range `<= 1.8.0`.
Fixed in PR #360 with a single root `overrides` entry, `smol-toml: 1.9.0`.

Two copies were in the lockfile: a hoisted `1.7.1` reached through `knip` (`^1.6.1`)
and `@astrojs/internal-helpers` (`^1.6.0`), and a nested `astro/smol-toml@1.9.0` that
existed only because `astro` asks for `^1.8.0`. One override collapses both and
deletes the duplicate. `1.9.0` satisfies every declared range (`^1.3.1`, `^1.6.0`,
`^1.6.1`, `^1.8.0`) and exports the same surface as `1.7.1` - `TomlDate`, `TomlError`,
`default`, `parse`, `stringify`. The advisory's `parseKey` is internal and was never
exported, so no consumer can break on the API.

The vulnerability was reproduced and the fix measured, both versions loaded in one
process on identical input. Cost per doubling of top-level keys:

| keys | 1.7.1 (vulnerable) | 1.9.0 (fixed) |
|---|---|---|
| 2 500 | 5.7 ms | 3.3 ms |
| 5 000 | 11.6 ms (x2.06) | 3.7 ms (x1.11) |
| 10 000 | 34.6 ms (x2.97) | 8.2 ms (x2.22) |
| 20 000 | 117.7 ms (x3.40) | 9.9 ms (x1.21) |
| 40 000 | 435.5 ms (x3.70) | 24.7 ms (x2.49) |

`1.7.1` converges on 4.00 per doubling - quadratic, exactly as described.
`1.9.0` stays near 2.00. The widening gap is the signature of a removed quadratic
term: 17.6x at 40 000 keys.

## 7. `postcss-selector-parser` - MODERATE, ACCEPTED: the only patched version is a major

`GHSA-rj75-hqrm-r3gf`, quadratic complexity in flat selector parsing, range
`< 7.1.6`. Two copies are vulnerable: a hoisted `6.1.4` (consumers `tailwindcss`
`^6.0.11`, `postcss-nested` `^6.1.1`, plus the tailwind builds bundled inside
`@jsx-email/cli` and `tw-to-css`) and a nested `7.1.4` under `@npmcli/query`.

`npm view postcss-selector-parser versions` ends at **7.1.6**, and the 6.x line stops
at 6.1.4. So `7.1.6` is the only version outside the vulnerable range, and applying
it to the hoisted copy is a **major** bump imposed on `tailwindcss@4.1.11`, which
declares `^6.0.11`.

An override to `7.1.6` was built and measured. It does resolve both copies and does
remove the advisory from `bun audit` (8 -> 7). Structurally it looks safe:

- the export surface is identical - the same 40 symbols, none removed or renamed;
- the resulting AST is identical on 16 realistic selector sets (pseudo-classes,
  nesting, `:is()`/`:where()`, container queries, escaped class names, sibling
  combinators) and on a 400-selector flat document, which is the shape the advisory
  calls out.

It is still not accepted as a fix, for two reasons that no local measurement can
close:

1. **No gate would catch a regression.** No required CI check on a PR to `dev`
   compiles the app CSS - the `vite build` steps live in `publish.yml` and
   `release.yml`, which run on release triggers, and `e2e (linux)` is not a required
   check and is red for unrelated reasons. A forced major that silently degraded
   Tailwind output would reach `dev` unnoticed.
2. **The build could not be validated here.** A CSS-only `vite` build with
   `@tailwindcss/vite` could not be completed on this machine, and the repo-wide
   `tsgo` typecheck OOMs (`cannot allocate memory`) on unmodified `dev` too, so local
   red is not attributable either way.

Accepted on the basis that the exposure is build-time only, on developer-controlled
input, and that the reachable consumers are `tailwindcss`, `postcss-nested` and two
bundled Tailwind copies - none of which parse untrusted CSS at runtime. Revisit when
`tailwindcss` itself moves to a `postcss-selector-parser@7` range, at which point the
override becomes a compatible bump with no gate gap.

## 8. `katex` - LOW, accepted

`GHSA-238p-pmpm-9mq7`, existing prototype pollution bypassing trust restrictions,
`>= 0.11.0, < 0.18.2`. Installed `0.16.27`, latest `0.19.0`. Reached via
`@unifia/ui › katex` and `marked-katex-extension`. The fix is a minor bump across
the 0.x line, which is breaking by semver convention and touches Markdown
rendering in the shipped UI. Left alone deliberately: a low-severity prototype
pollution in a rendering library is not worth a rendering regression discovered
during release 1. Revisit with the UI dependency set.

---

## 9. `vite` 4.5.14 - dev-server advisories, developer-only path, ACCEPTED, expires 2026-11-07

Checked 2026-10-10 against `bun audit` and the GitHub advisory API. Every advisory
below is a defect of the **Vite development server**, not of Vite's production build:

- `GHSA-c27g-q93r-2cwf` (high): launch-editor command injection on Windows, `vite <= 5.4.8`.
- `GHSA-fx2h-pf6j-xcff` (high): `server.fs.deny` bypass on Windows alternate paths, `vite <= 6.4.2`.
- `GHSA-v6wh-96g9-6wx3` (medium): launch-editor NTLMv2 hash disclosure via UNC paths on Windows.
- `GHSA-93m4-6634-74q7` (medium): `server.fs.deny` bypass via backslash on Windows, `vite <= 5.4.20`.
- `GHSA-4w7w-66w2-5vf9` (medium): path traversal in optimized-deps `.map` handling, `vite <= 6.4.1`.
- `GHSA-g4jq-h2w9-997c`, `GHSA-jqfw-vq24-v9c3` (low): static-serving edge cases.

**Only path in this repository.** `bun why vite` gives one path to `4.5.14`:
`vite@4.5.14 ← @jsx-email/cli@1.4.3 ← @unifia/console-mail` (private package,
`packages/console/mail`). The package script is `"dev": "email preview emails/templates"`.
`@jsx-email/cli` `dist/src/commands/preview.js` calls `createServer(...)` and
`server.listen()` (lines 88-90), with `host` defaulting to `false` (localhost) and
`--host` binding `0.0.0.0`.

**What does not reach it, checked on the code:**

- `email build` does not load vite (`dist/src/commands/build.js` has no vite import).
- The console runtime imports one template from the package, dynamically
  (`packages/console/core/src/user.ts:141`, `@unifia/console-mail/InviteEmail.jsx`).
  It does not import the CLI or vite.
- None of the shipped roots (`app`, `desktop`, `desktop-electron`, `mobile`, `unifia`)
  depends on `console-mail`, so `vite@4` is absent from every distributed artifact.

**Exposure.** The vite dev server runs only while a developer runs `bun run dev` in
`packages/console/mail`. With the default localhost bind it is reachable by the
developer's own machine; a web page open in that developer's browser may be able to
send it requests. This was not verified here. With `--host` it is reachable from the
local network. End users of Unifia have no path to it.

**Decision.** Accepted for the developer-only path, with two conditions:

1. Do not pass `--host` to the preview server.
2. Stop the preview server when it is not in use.

Not accepted: the same CLI in any served context. A change that renders console email
through this tool inside the console at runtime invalidates this section.

**Expires 2026-11-07.** Before then, the owner chooses one of: remove `@jsx-email/cli`
from `console-mail`, or move the preview to a current Vite. The second needs a major
bump of the email tool, and that tool pins `react-router-dom` 6 (see sections 2 & 3).

---

## How to re-measure

```
bun audit
bun why <package>
npm view <package> version
gh api advisories/GHSA-xxxx-xxxx-xxxx     # check published_at before believing a count changed
```

Measured on `dev@66b6071df` with `bun 1.3.14` at 2026-10-06, then re-measured after
the continuation above. Every section is now either fixed, waiting on an upstream
release, or accepted in writing: `smol-toml` is fixed by #360, and
`postcss-selector-parser` is accepted with the reasoning recorded in section 7. No
entry is left in the "fixable on request" state.