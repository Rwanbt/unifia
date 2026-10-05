<!-- SPDX-License-Identifier: MIT -->
# Dependency acceptances — issue #33

Every advisory `bun audit` still reports on `dev`, and why it is still reported.
Written on 2026-10-05 by lane D against `dev@56ad2a2ad`, with `bun 1.3.14`.

`bun audit` on that tree:

```
5 vulnerabilities (2 high, 2 moderate, 1 low)
```

After PR #304 (`http-cache-semantics` 4.2.0 → 4.3.0):

```
4 vulnerabilities (1 high, 2 moderate, 1 low)
```

| # | advisory | severity | package | fixed here? |
|---|---|---|---|---|
| 1 | GHSA-ch52-4w7c-c8xp | high | `http-cache-semantics <=4.2.0` | **yes**, PR #304 |
| 2 | GHSA-vfj7-8cjw-p6xm | high | `braces <=3.0.3` | no version exists — see below |
| 3 | GHSA-wrjc-x8rr-h8h6 | moderate | `react-router >=6.0.0 <7.18.0` | accepted, see below |
| 4 | GHSA-337j-9hxr-rhxg | moderate | `react-router >=6.4.0 <7.18.0` | accepted, see below |
| 5 | GHSA-j965-2qgj-vjmq | low | `aws-sdk >=2.0.0 <=3.0.0` | accepted, see below |

Nothing here is dismissed, suppressed or excluded anywhere: no `.auditignore`,
no `overrides` pinning a vulnerable version, no allowlist in CI. Where an
advisory cannot be removed, what follows is the reachability and the cost.

---

## 2. `braces` — HIGH, no patched version exists. NEEDS-OWNER.

`GHSA-vfj7-8cjw-p6xm`, range `<= 3.0.3`.

**There is nothing to bump to.** `npm view braces version` → `3.0.3`, and the
lockfile resolves `braces@3.0.3` hoisted for `micromatch@4.0.8` (which requires
`^3.0.3`). The set of non-vulnerable published versions is empty. Any override
would have to point at a version that does not exist or at a fork, which is
worse than the advisory.

**Who reaches it.** `bun why braces` gives the paths, and one of them is runtime,
not build-time:

```
braces@3.0.3
  ├─ micromatch@4.0.8 (requires ^3.0.3)
  │   ├─ @parcel/watcher@2.5.1 (requires ^4.0.5)   → unifia        ← runtime
  │   ├─ @jsx-email/doiuse-email@1.0.4             → console-mail
  │   ├─ @solidjs/start@2.0.0-alpha.3              → console-app
  │   ├─ fast-glob@3.3.3 / globby / tailwindcss@3.3.3 / vite-plugin-dynamic-import
  └─ (all of the above, plus @jsx-email/tailwind → tw-to-css)
```

`@parcel/watcher` is imported by shipped code — `packages/unifia/src/file/watcher.ts:3`
and `src/file/index.ts:979` — and its wrapper calls
`micromatch.makeRe(value)` on **every ignore pattern**
(`node_modules/@parcel/watcher/wrapper.js:17`).

**Whether an attacker can supply that pattern.** Yes, not only the user. The
watcher takes its ignore list from `cfg.watcher?.ignore`, and
`packages/unifia/src/config/config.ts:707-713` merges project config files found
by walking up from the working directory, gated only by
`Flag.UNIFIA_DISABLE_PROJECT_CONFIG`. A repository that ships

```json
{ "watcher": { "ignore": ["{a,{a,{a,...}}}"] } }
```

puts that pattern in front of the compiler when the victim opens the project. So
this is not a "build-time only, developer-controlled input" advisory, and it is
not written up as one.

**What it actually costs, measured.** The advisory says stack exhaustion. What
the installed version does was measured rather than assumed:

| nested braces | `micromatch.makeRe` |
|---|---|
| 1 000 | 46 ms |
| 5 000 | 783 ms |
| 20 000 | **12 731 ms** |
| 100 000 | `SyntaxError`, V8's own 65536-char regex ceiling |

So: superlinear compile cost reaching 12.7 s on the watcher-init path, and a hard
stop only once the pattern is large enough to trip V8. A denial of service in
substance, a stack exhaustion in neither letter nor mechanism. Combinatorial
shapes (`{a,b}` repeated) were also probed and are cheap: 30 repetitions compile
in under a millisecond, because the compile is per-group rather than expanding.

**What was done about it, since bumping is impossible.** A bound at the product
boundary, in the same PR as this file:

- `FileIgnore.MAX_BRACE_DEPTH = 32`, `isPathologicalPattern()`,
  `boundPatterns()` in `packages/unifia/src/file/ignore.ts`.
- `FileWatcher` applies it to `cfg.watcher.ignore` and logs every pattern it
  drops, because a dropped ignore pattern means watching *more* than asked and
  must not be silent.
- `packages/unifia/test/file/ignore-glob-depth.test.ts` pins the behaviour and
  asserts that none of the product's own `PATTERNS` is affected.

32 is far above any real ignore pattern; the product's own list never nests and
is asserted still to pass.

**Why this is NEEDS-OWNER and not accepted outright.** `bun audit` will keep
reporting a high until `braces` publishes a fix, and this bound does not change
that number — it changes whether the finding is exploitable. Releasing with a
standing high advisory whose exploitability has been bounded at the boundary is a
judgement about the release, and that judgement is the owner's (DECISIONS.md,
actions réservées au propriétaire). What is being asked for is a decision to
ship release 1 in this state, not a fix.

---

## 3 & 4. `react-router` — MODERATE ×2, accepted

`GHSA-wrjc-x8rr-h8h6` (open redirect via backslash in `<Link>` and `useNavigate`,
range `>= 6.0.0, < 7.18.0`) and `GHSA-337j-9hxr-rhxg` (constructor injection via
`deserializeErrors()` in SSR hydration, range `>= 6.4.0, < 7.18.0`). Both name
**7.18.0** as the first patched version. The lockfile resolves
`react-router@6.30.4`, forced there by the root `overrides` block.

Single dependency path:

```
@unifia/console-mail › @jsx-email/cli@1.4.3 › react-router-dom@6.16.0 › react-router@6.30.4
```

Two reasons this is accepted rather than fixed.

**The fix is a major bump onto a tool pinned to 6.x.** `@jsx-email/cli@1.4.3`
declares `react-router-dom: 6.16.0` and `react: 18.2.0`. Moving it to
`react-router >= 7.18.0` is the major-version override this repository has
already been bitten by once — the root `overrides` block still carries
`"@ai-sdk/provider-utils": "4.0.56"` for exactly that reason. Trading a
moderate, dev-only advisory for a build that may not resolve is a bad trade.

**Neither advisory's code path exists in a Unifia runtime.** The console is
SolidJS on `@solidjs/start`, not React Router: `deserializeErrors()` is a React
Router *SSR hydration* entry point and there is no React Router SSR in this
deployment. The open-redirect advisory needs a user-supplied redirect target
reaching `<Link>` or `useNavigate`; `packages/console/app` has no React Router
route tree at all. React Router code executes only inside the `email` CLI's local
template-preview server, which is a developer tool started by hand.

**Residual.** `@unifia/console-mail` is a *production* dependency of both
`@unifia/console-app` and `@unifia/console-core`, and the CLI ships inside it.
A future change that renders console email through that tool in a served context
would invalidate this acceptance. It is worth revisiting if the console is
retired (PROD_READINESS.md already records the console as outside the delivered
roots) or if `@jsx-email/cli` publishes a 7.x-compatible release.

---

## 5. `aws-sdk` — LOW, accepted

`GHSA-j965-2qgj-vjmq`: JavaScript SDK v2 users should validate the `region`
parameter or migrate to v3. Range `>= 2.0.0, <= 3.0.0`,
`first_patched_version: null` — the advisory is a migration notice, not a
memory-safety or RCE issue.

Single path: `sst@3.18.10 › aws-sdk@2.1692.0`. `sst` is a **root
devDependency**, the SST CLI used for local dev and infra definitions. The
`region` values it passes come from `sst.config.ts` / the developer's own shell
environment — the person running the command already has full local authority.
Nothing in this repository constructs an AWS SDK v2 client with a
request-derived region.

The fix is migrating `sst` off `aws-sdk` v2, which is `sst`'s decision and its
release schedule, not this repository's. Re-checked whenever `sst` is bumped.

---

## How to re-measure

```
bun audit
bun why <package>
```

Both were run on `dev@56ad2a2ad` with `bun 1.3.14`. If a future `braces` release
appears, `npm view braces version` is the check that decides whether acceptance 2
can be retired — everything else in this file is waiting on an upstream release,
not on work here.