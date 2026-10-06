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

## 1. `braces` - HIGH, no patched version exists. NEEDS-OWNER.

`GHSA-vfj7-8cjw-p6xm`, range `<= 3.0.3`.

**There is nothing to bump to.** `npm view braces version` is `3.0.3`: the newest
published version, and the advisory range includes it. The set of non-vulnerable
versions is empty. An override would have to point at a version that does not
exist or at a fork.

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

**NEEDS-OWNER, not accepted outright.** This bound does not change what
`bun audit` reports, only whether the finding is exploitable. Releasing with a
standing high advisory whose exploitability is bounded at the boundary is a
judgement about the release, and that judgement is the owner's. The ask is a
decision, not a fix. Re-check whenever `braces` publishes: `npm view braces
version` is the test that retires this section.

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

## 6. `smol-toml` - MODERATE, fixable on request

`GHSA-r4xh-jqrq-34v2`, quadratic `parse()` from `parseKey`, range `<= 1.8.0`.
Installed `1.7.1`, latest `1.9.0`. Reached via `knip › smol-toml` and
`@astrojs/markdown-remark › @astrojs/cloudflare`, plus `@npmcli/arborist` -
build-time and npm-metadata parsing. Not fixed by this lane: it needs a minor bump
across the Astro toolchain and a full `bun turbo typecheck`, and it is a
moderate, so it belongs to its own PR rather than being folded into a security
gate. `1.9.0` is outside the range and is the candidate when someone picks it up.

## 7. `postcss-selector-parser` - MODERATE, fixable on request

`<7.1.6`, reached via `@unifia/app › tailwindcss`, `@unifia/console-core ›
drizzle-orm` and `@unifia/desktop-electron › electron`/`electron-builder`.
Build-time CSS selector parsing. Same reasoning as `smol-toml`: candidate for its
own PR.

## 8. `katex` - LOW, accepted

`GHSA-238p-pmpm-9mq7`, existing prototype pollution bypassing trust restrictions,
`>= 0.11.0, < 0.18.2`. Installed `0.16.27`, latest `0.19.0`. Reached via
`@unifia/ui › katex` and `marked-katex-extension`. The fix is a minor bump across
the 0.x line, which is breaking by semver convention and touches Markdown
rendering in the shipped UI. Left alone deliberately: a low-severity prototype
pollution in a rendering library is not worth a rendering regression discovered
during release 1. Revisit with the UI dependency set.

---

## How to re-measure

```
bun audit
bun why <package>
npm view <package> version
gh api advisories/GHSA-xxxx-xxxx-xxxx     # check published_at before believing a count changed
```

Measured on `dev@66b6071df` with `bun 1.3.14` at 2026-10-06. Every section above
is waiting on an upstream release or an owner decision, not on work here, with two
exceptions: `smol-toml` and `postcss-selector-parser` are fixable now and are
listed as such rather than accepted.