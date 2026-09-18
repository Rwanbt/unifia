<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# HANDOFF — Unifia v110 UI/UX port (branch `new-ui`)

Written 2026-09-18 at the end of an OpenCode session, for continuation in Claude Code.
Read this file first, completely, before running anything.

---

## 0. Ground truth — verify these before you trust anything below

```bash
git -C "D:/App/unifia/_a7-automate-memory" branch --show-current   # must be: new-ui
git -C "D:/App/unifia/_a7-automate-memory" log --oneline -1        # expect: f43661f90a
git -C "D:/App/unifia/_a7-automate-memory" status --short
```

- **Working checkout is NOT `D:/App/unifia`.** That path is not a git repo.
  Work only in `D:/App/unifia/_a7-automate-memory`.
  (`D:/App/unifia/unifia` is a separate checkout sitting on `main` — never touch it.)
- Branch `new-ui`. Never commit to `main` or `work-design`.
- No PRs, no feature branches, no worktrees. Autonomous increments on `new-ui` only.
- Never force-push. Fetch and compare before every push:
  `git -C "D:/App/unifia/_a7-automate-memory" fetch origin new-ui` then compare `HEAD` to `origin/new-ui`.
- Push: `git -C "D:/App/unifia/_a7-automate-memory" push origin new-ui`
- 86 commits since `8cc914c0ea`. Last pushed: `f43661f90a`.

## 1. What "the maquette" is — the appearance authority

`docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html`

Frozen. Do not edit it. SHA-256 must be:
`6c01e84c27abf7665bb4de65e0c3969b7af0f020129aa971916376b1ca69818b`

Verify before relying on it:
```bash
sha256sum docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html   # or Get-FileHash on Windows
```

Key line references inside it: topbar 15226 · watermark 15273 · state-line 15277 ·
title 15281 · subtitle 15282 · composer-card 15285 · quick-chips 15309-15312 ·
mode pills 15314-15320 · rail 15326-15350 · work-view 15435 · work-grid 15437 ·
composer 15378 · editor 15389 · terminal 15417 · automate-view 15675 ·
memory-view 15790 · inspector 16988 · settings-dialog 17010.

## 2. Two operating rules that will bite you

### Commit discipline (§7/§90)

Harness+UI or policies+UI in the SAME commit is an `INVALID_CHECKPOINT`. Keep
harness changes, policy changes and UI changes in separate commits.
`.husky/pre-commit` runs `parity:checkpoint:lint HEAD` which enforces this on the
staged diff. If a commit fails, fix the cause — **never weaken a gate**.
Generic biome failures can occur under load (exit 9); re-run the lint standalone
and retry the commit.

### LOC gate

The edit tool blocks files over 1500 lines (e.g. `packages/app/src/i18n/en.ts` is
2088). CSS is split into `v110-*.css` layers to stay under the limit.

### Windows/PowerShell gotchas (cost real time this session)

- `"` inside a `-m "..."` commit message is NOT escaped by `\"`. Use a message
  file: `git commit -F path/to/msg.txt`. This silently produced
  `fatal: Invalid path '/shell.rail'` once.
- Inline `node -e "..."` gets mangled by PowerShell when it contains `$` or
  newlines. Write a `.mjs` script file and run that instead.
- Non-ASCII round-trips badly through some edit paths. This session an em-dash
  became `U+FFFD` + quote and **broke a string literal**. Keep string literals
  ASCII-only.
- `grep` is not available; use the Grep tool or `Select-String`.
- npm scripts here need `--cwd packages/app`.

## 3. Where the project actually stands

`parity/STATE.md` is the running state and corrections log — read it. Its Verdict
is currently `NOT_QUALIFIED`, which is expected: S15 full qualification has not
run.

### Done and verified

- Tailwind regression fixed (an earlier commit had dropped
  `@import "@unifia/ui/styles/tailwind"` from `packages/app/src/index.css`).
- Home full-bleed, light-mode palette, watermark, home topbar + working theme toggle.
- 192 inert CSS class selectors deleted; dead-CSS detector added.
- 16 manifest fragments (`packages/app/e2e/v110/parity-manifest/*.json`).
- 6 unportable anchors recorded in `parity/manifest-findings.json`.
- `parity:evidence:host` — **12 gates, overall PASS**.
- **`shell.rail` uniqueness bug fixed** (`1c8172e31a`), found by runtime pairing.
- **12 of 16 fragments pair exactly against the live DOM.**

### Gate commands (all must pass before any checkpoint)

```bash
bun run --cwd packages/app typecheck
bun run --cwd packages/app parity:contract
bun run --cwd packages/app parity:path-classification:check
bun run --cwd packages/app parity:manifest:check
bun run --cwd packages/app parity:checkpoint:lint HEAD
bun run --cwd packages/app parity:evidence:host     # 12 gates, ~long
```

`parity:path-classification:check` now **compares** its baseline
(`parity/path-classification-coverage.json`) instead of overwriting it, and exits
0 only when there is no drift. If you intentionally change the tracked-file set:
`bun run --cwd packages/app scripts/parity/path-classification-check.ts --refresh`

## 4. IN FLIGHT — uncommitted work you must deal with first

`packages/app/scripts/parity/runtime-pair.ts` is **untracked and not committed.**

It pairs the 16 manifest fragments against a live browser over CDP. It works, but
**it is NOT deterministic yet and must not be committed as-is.** Three consecutive
runs against the same browser produced: `12/0/4`, then `10/2/4`, then a hard throw.

Measured facts about it:

- **Run it with node, not bun:**
  ```bash
  node --experimental-strip-types packages/app/scripts/parity/runtime-pair.ts \
    --cdp=http://127.0.0.1:9333 \
    --project=<urlencoded-project-path>
  ```
  Under bun 1.3.14 `connectOverCDP` times out on this host. Under node 22.15 it
  connects. That is why the file is self-contained (it deliberately does NOT
  import `./shared`, which uses bun-only `import.meta.dir`).
- Needs an **isolated** browser (see §5). Do not point it at port 9222.
- `browser.close()` is in a `finally`, and must stay there: a leaked CDP session
  blocks every later connect. Do NOT add a `process.exit` inside the try.

### Defect 1 — theme resolution is order-dependent

The app's theme toggle button exists **only on the home route**, so the runner
sets the theme once on `/` before walking the scenes. `emulateMedia` is applied
and then reset in a `finally`. It is still flaky: run C threw
`could not force theme dark on home`.

Root cause not yet found. The prime suspect is that the toggle flips a *stored*
preference, so by run C the app has a persisted explicit scheme that fights
`emulateMedia`, and `document.documentElement[data-color-scheme]` never settles
on the declared value within 3 attempts.

**Next step to try:** make the theme explicit rather than toggled — drive the
settings control (`data-action="settings-color-scheme"`, see
`packages/app/src/components/settings-general.tsx:346`) to set the scheme
directly, or clear the persisted preference before each run. Do not paper over it
by increasing the attempt count.

### Defect 2 — the theme/home state bleeds into scene navigation

Run B: `work.shell` and `work.content` measured 0/1 (should be 1/1) on `/work`,
while every other scene passed. The `/work` route was reached but its content had
not mounted — most likely the runner navigates before the previous route's state
settles, or the theme flip caused a remount mid-measure.

**Next step to try:** replace the fixed `waitForTimeout(1200)` after `goto` with a
real readiness wait (`waitForSelector` on the scene's own anchor, or
`waitForFunction` on `document.querySelector('[data-route]')` matching the
expected route). A fixed timeout is the actual bug here.

Fix both, then prove determinism: **three consecutive runs on one browser, all
`12/0/4`, exit 0.** Only then commit it — as a harness-only commit, separate from
any UI or policy change.

## 5. Reproducing the browser environment (verified commands)

Playwright's `chromium.launch()` **hangs** on this host, and
`npx playwright install chrome` is privilege-blocked. So: attach over CDP to a
browser you start yourself.

```powershell
$dir = "C:\Users\barat\AppData\Local\Temp\opencode\brave-pair"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
Start-Process -FilePath "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" `
  -ArgumentList '--headless=new','--remote-debugging-port=9333',"--user-data-dir=$dir", `
                '--no-first-run','--no-default-browser-check','about:blank' -WindowStyle Hidden
Start-Sleep -Seconds 6
(Invoke-WebRequest -Uri "http://127.0.0.1:9333/json/version" -TimeoutSec 4).Content
```

**Port 9222 is a DIFFERENT browser** — `--user-data-dir=...hbtn-automation`,
a Holberton intranet automation instance. It is not yours. Use 9333, or any free
port, with your own `--user-data-dir`.

**Also critical:** the brave-devtools MCP (`brave-devtools_*` tools) and a
Playwright CDP client **compete for the same browser-level CDP session**. Attaching
Playwright to the MCP's browser makes both flaky and can wedge the MCP. Keep them
in separate browser instances.

Dev servers: backend `:4096`, Vite `:4444`.
`packages/app/AGENTS.md` says **never restart the app or the server process.**
The backend was **down** for this whole session, which is why the workbench bridge
reported unavailable and why file lists were empty.

## 6. What is still unpaired, and exactly why

12 of 16 fragments pair. The remaining 4 are **BLOCKED, not failing**:

- `code.editor`, `code.terminal` — need a file open, which needs the backend on
  `:4096`. The runner now reports these as BLOCKED deliberately; a FAIL would
  wrongly imply a rendering defect.
- `automate.surface` — capability-gated. With no project open, the home pill
  opens the "Ouvrir un projet" dialog instead of switching mode.
- `memory.panel` — unreachable in this workspace. The rail exposes only
  Code / Travail / Design; no affordance reaches Memory.

`settings.dialog` **does** pair (opened via `Control+Comma`, which is
locale-independent). Design mode renders at `/design` but has **no fragment**, so
there is nothing to pair; its empty canvas column is the already-documented A6 gap
(`COMPONENT-MAP §8`), not a new bug.

## 7. Blocked / needs a decision from the human

1. **e2e is UNVERIFIED on this host.** `bun run --cwd packages/app test:e2e` cannot
   execute here. This is the single biggest gap.
2. **F0 Docker harness absent** — `runtime.ts` runners (`aa`, `aa-prime`, `visual`,
   `motion`, `mutations`, `g3`, `full`) stay `PENDING_IMPL`.
3. **Product approval missing** for 3 `intentional-difference` dispositions
   (`home.quick-chip`, `shell.rail-buttons`, `shell.workspace-tabs`) and a
   reference strategy for `code.diff` (`blocked-external`).
4. **The backend on `:4096` is down.** Starting it is documented in
   `packages/app/AGENTS.md` but that file forbids restarting server processes. The
   previous session did not start it unilaterally. **Ask the human.**

## 8. What was considered and rejected — do not re-litigate

Six gates show `status: null` in `parity/artifacts/host-evidence.json`
(census-run, tokens-audit, motion-static, census-extended, unit, g0-mode-derive).
**This is not fail-open.** `evidence-host.ts:139` derives `overall` from
`exitCode`, exactly as its header documents. Those gates emit artifacts rather
than stdout JSON, so there is no status to parse. exitCode is the authority.

Also: the census counts **source occurrences, not DOM elements**, so a ternary
emitting the same anchor in two branches (e.g. `code.editor` in
`packages/app/src/pages/session/file-tabs.tsx:197` and `:204`, two branches spread
onto one `<Dynamic>`) shows as a duplicate while only one element exists at
runtime. This is exactly why runtime pairing exists and why the `shell.rail`
defect could only be found against the DOM.

## 9. Your first actions, in order

1. Read `parity/STATE.md` and this file end to end.
2. Run the §0 verification commands. Confirm `new-ui`, `f43661f90a`.
3. Run all of §3. All six gates must pass before you change anything.
4. Then fix the two defects in §4 in `runtime-pair.ts`.
5. Prove determinism (3 runs, `12/0/4`, exit 0). Commit as harness-only.
6. Only then consider adding it to `evidence-host` — and if you do, keep it
   **non-required** (report, don't gate): it needs an external browser, so a
   required gate would make `evidence-host` unrunnable in CI.

Report honestly. If a run is flaky, say so and show the raw counters. Do not
describe a gate as passing when it was only skipped.
