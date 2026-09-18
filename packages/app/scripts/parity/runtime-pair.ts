// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:runtime:pair -- pairs the declared manifest fragments against the live
// DOM of a browser reached over CDP. This is the runtime half of parity: the
// manifest gate proves the contract statically, this one proves it renders.
//
// Why CDP and not a fresh launch: chromium.launch() wedges on this Windows host,
// so the launch path is avoided entirely by attaching to a browser that is
// already running (started with --remote-debugging-port, exposing /json/version).
//
// Why this file is self-contained and run by node rather than bun: measured on
// this host, playwright's connectOverCDP succeeds under node 22.15 and times out
// under bun 1.3.14. It therefore does NOT import ./shared -- that module uses
// bun-only import.meta.dir -- and is launched with
// `node --experimental-strip-types`.
//
// One CDP client per browser: a leaked session blocks every later connect, so
// browser.close() is guaranteed by a finally. Do not reintroduce an early
// process.exit inside the try.
//
// A scene that cannot be realised is reported BLOCKED with a reason. It is never
// silently skipped, because a skipped fragment reads as a passing one.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Page } from "playwright"

function repoRoot(start: string): string {
  let dir = start
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(dir, ".git"))) return dir
    const parent = resolve(dir, "..")
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`repo root not found above ${start}`)
}

const ROOT = repoRoot(dirname(fileURLToPath(import.meta.url)))
const MANIFEST_DIR = join(ROOT, "packages", "app", "e2e", "v110", "parity-manifest")
const ARTIFACTS_DIR = join(ROOT, "parity", "artifacts")

type Fragment = {
  id: string
  scene: string
  app: { selector: string; count: number; visibleCount: number }
  viewports: string[]
  themes: string[]
}

type Outcome = { id: string; scene: string; status: "PASS" | "FAIL" | "BLOCKED"; detail: string }

// Only the viewport names the fragments actually declare are mapped. An
// unmapped name fails rather than silently measuring at the wrong size.
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  "desktop-wide": { width: 1440, height: 900 },
}

const args = process.argv.slice(2)
const arg = (name: string, fallback: string): string => {
  const hit = args.find((entry) => entry.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const cdp = arg("cdp", "http://127.0.0.1:9222")
const base = arg("base", "http://127.0.0.1:4444").replace(/\/+$/, "")
const project = arg("project", "")

// Mirrors STORAGE_KEYS.COLOR_SCHEME in packages/ui/src/theme/context.tsx. Kept as
// a literal, not an import, because this file is deliberately standalone (see
// header) and does not pull in app modules.
const COLOR_SCHEME_STORAGE_KEY = "unifia-color-scheme"

// Scene -> the route that realises it. null means the surface is unreachable
// here; the reason is recorded instead of the fragment being dropped.
//
// code.default is deliberately absent: its route would be the session, but the
// editor only mounts once a file is open, which needs the backend on :4096. With
// the backend down the honest verdict is BLOCKED, not FAIL -- FAIL would read as
// a rendering defect when nothing is actually wrong.
function route(scene: string): string | null {
  if (scene === "home.default") return `${base}/`
  if (!project) return null
  if (scene === "shell.default" || scene === "settings.default") {
    return `${base}/${project}/session`
  }
  if (scene === "work.default") return `${base}/${project}/work`
  return null
}

const REASONS: Record<string, string> = {
  "memory.default": "memory mode is unreachable in this workspace; the rail exposes only code/work/design",
  "automate.default": "automate mode is capability-gated; the home pill opens the project dialog instead",
  "code.default": "code scene needs a file open, which needs the backend on :4096",
}

const fragments: Fragment[] = readdirSync(MANIFEST_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(MANIFEST_DIR, name), "utf8")) as Fragment)

const outcomes: Outcome[] = []

const browser = await chromium.connectOverCDP(cdp)
// Declared outside try/catch so the finally block below can close it. Found
// while proving determinism: browser.close() (below) detaches this script's
// CDP session but does NOT close the page it created on a CDP-attached
// browser -- 3 consecutive runs against the same browser (as this harness
// requires) left 15 tabs open, each retrying its failed connection to the
// down backend, until the browser answered a later navigation with
// net::ERR_INSUFFICIENT_RESOURCES. page.close() in the same finally as
// browser.close() prevents that accumulation.
let createdPage: Page | undefined
try {
  const context = browser.contexts()[0]
  if (!context) throw new Error("CDP browser exposed no context")

  const page = await context.newPage()
  createdPage = page

  const scenes = [...new Set(fragments.map((fragment) => fragment.scene))].sort()

  const themes = [...new Set(fragments.map((fragment) => fragment.themes[0] ?? "dark"))].sort()
  if (themes.length > 1) {
    throw new Error(`runtime pairing with multiple themes is not implemented: ${themes.join(", ")}`)
  }
  const theme = themes[0] ?? "dark"

  // All 16 fragments declare the same viewport, so it is resolved and applied
  // once, up front, the same way theme is. This also fixes a real bug found
  // while proving determinism: a freshly-created CDP page defaults to a
  // narrow viewport (758x488 measured on this host), and settings-general.tsx
  // switches to <SettingsMobileNav> below its mobile breakpoint. The
  // settings.default scene opens the dialog via a keypress BEFORE its own
  // per-fragment loop would have set the viewport, so it rendered the mobile
  // nav -- which has no data-parity="settings.dialog" marker -- instead of
  // <DialogSettingsDesktop />. Setting it before any navigation, not inside
  // the per-fragment loop, closes that gap for every scene, not just settings.
  const viewportNames = [...new Set(fragments.map((fragment) => fragment.viewports[0] ?? ""))]
  if (viewportNames.length > 1) {
    throw new Error(`runtime pairing with multiple viewports is not implemented: ${viewportNames.join(", ")}`)
  }
  const viewportSize = VIEWPORTS[viewportNames[0] ?? ""]
  if (!viewportSize) {
    throw new Error(`unmapped viewport: ${viewportNames[0] ?? "(none)"}`)
  }
  await page.setViewportSize(viewportSize)

  // Fix for HANDOFF §4 defect 1 (order-dependent theme). The previous approach
  // clicked the app's toggle button, which exists only on home and flips
  // relative to the CURRENT mode -- so it raced the app's own "system"-scheme
  // reactivity (emulateMedia triggers a matchMedia change event the app
  // listens to) and could pin the wrong explicit value into localStorage, which
  // then outlives the run because the CDP browser's profile is reused across
  // the 3 consecutive invocations this harness must be deterministic under.
  // Writing the storage key directly, via an init script that reapplies on
  // every navigation, removes the click, removes emulateMedia, and removes the
  // dependency on whatever a previous run left behind: every single page load
  // in this run boots with the explicit value already set, before the app's
  // own theme context ever reads localStorage.
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      localStorage.setItem(key, value)
    },
    { key: COLOR_SCHEME_STORAGE_KEY, value: theme },
  )

  async function measure(selector: string): Promise<{ raw: number; visible: number }> {
    return page.evaluate((sel) => {
      const all = [...document.querySelectorAll(sel)]
      const visible = all.filter((el) => {
        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
      })
      return { raw: all.length, visible: visible.length }
    }, selector)
  }

  // The init script above should make this true immediately on every load;
  // this is now a fast assertion (waitForFunction resolves on its own polling
  // interval, no manual retry loop), not the mechanism that sets the scheme.
  // Kept so a real regression FAILs loudly instead of measuring against the
  // wrong palette.
  async function verifyColorScheme(expected: string): Promise<boolean> {
    try {
      await page.waitForFunction(
        (want) => document.documentElement.getAttribute("data-color-scheme") === want,
        expected,
        { timeout: 5000 },
      )
      return true
    } catch {
      return false
    }
  }

  // Fix for HANDOFF §4 defect 2 (fixed wait after navigation). Mirrors the
  // kinds parseModeLocation() in packages/app/src/context/mode-directory.ts
  // assigns each URL shape this file's route() builds. A real readiness
  // signal replaces the blind waitForTimeout(1200) that let run B measure
  // /work before its content had mounted.
  function expectedRouteKind(scene: string): string | null {
    if (scene === "home.default") return "home"
    if (scene === "shell.default" || scene === "settings.default") return "workspace-root"
    if (scene === "work.default") return "mode"
    return null
  }

  for (const scene of scenes) {
    const members = fragments.filter((fragment) => fragment.scene === scene)
    const target = route(scene)

    if (!target) {
      const reason = REASONS[scene] ?? (project ? "no route defined for this scene" : "no --project given")
      for (const fragment of members) outcomes.push({ id: fragment.id, scene, status: "BLOCKED", detail: reason })
      continue
    }

    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 })

    // A scene whose readiness signal never arrives is a real FAIL for its
    // fragments, not a crash that discards every other scene's outcome. The
    // pre-fix script had exactly this failure mode (HANDOFF §4: "then a hard
    // throw" on the third of three runs).
    try {
      const expectedKind = expectedRouteKind(scene)
      if (expectedKind) {
        await page.waitForFunction(
          (kind) => document.querySelector("[data-route]")?.getAttribute("data-route") === kind,
          expectedKind,
          { timeout: 20000 },
        )
      }

      if (scene === "settings.default") {
        await page.keyboard.press("Control+Comma")
        // Same principle as the goto readiness wait above: wait for the
        // dialog's own anchor (the scene's sole fragment) instead of a fixed
        // delay.
        await page.waitForSelector(members[0]!.app.selector, { state: "attached", timeout: 10000 })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const fragment of members) {
        outcomes.push({ id: fragment.id, scene, status: "FAIL", detail: `scene did not become ready: ${message}` })
      }
      continue
    }

    for (const fragment of members) {
      const fragmentTheme = fragment.themes[0] ?? "dark"
      if (!(await verifyColorScheme(fragmentTheme))) {
        outcomes.push({ id: fragment.id, scene, status: "FAIL", detail: `color-scheme never reached ${fragmentTheme}` })
        continue
      }

      // The outer data-route flip (waited on above) is necessary but not
      // sufficient: measured directly, home's own content (e.g. home.title)
      // still reads 0 for ~300ms after data-route already says "home" --
      // there is an async gap between the shell mounting and the scene's own
      // content mounting inside it. Waiting for THIS fragment's own selector
      // closes that gap without a guessed delay; a genuine non-mount still
      // FAILs below instead of hanging, since measure() reports the real 0.
      await page.waitForSelector(fragment.app.selector, { state: "attached", timeout: 15000 }).catch(() => {})

      const got = await measure(fragment.app.selector)
      const want = { raw: fragment.app.count, visible: fragment.app.visibleCount }
      const ok = got.raw === want.raw && got.visible === want.visible
      outcomes.push({
        id: fragment.id,
        scene,
        status: ok ? "PASS" : "FAIL",
        detail: ok
          ? `raw ${got.raw} visible ${got.visible} (as declared)`
          : `raw ${got.raw}/${want.raw} visible ${got.visible}/${want.visible}`,
      })
    }
  }
} finally {
  // page.close() first: browser.close() only detaches this run's CDP session
  // (a leaked one blocks every later connect) but leaves the tab itself open
  // on a CDP-attached browser, which is how 3 consecutive runs accumulated
  // 15 dangling tabs and eventually hit net::ERR_INSUFFICIENT_RESOURCES.
  await createdPage?.close().catch(() => {})
  await browser.close().catch(() => {})
}

const passed = outcomes.filter((outcome) => outcome.status === "PASS").length
const failed = outcomes.filter((outcome) => outcome.status === "FAIL").length
const blocked = outcomes.filter((outcome) => outcome.status === "BLOCKED").length

if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true })
writeFileSync(
  join(ARTIFACTS_DIR, "runtime-pair.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      cdp,
      base,
      project,
      counters: { fragments: fragments.length, passed, failed, blocked },
      outcomes,
    },
    null,
    2,
  ),
)

const result = {
  status: failed === 0 ? "PASS" : "FAIL",
  counters: { fragments: fragments.length, passed, failed, blocked },
  details: outcomes.map((outcome) => `${outcome.status}: ${outcome.id} (${outcome.scene}) -- ${outcome.detail}`),
}

if (failed === 0) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
  process.exit(0)
}
process.stderr.write(JSON.stringify(result, null, 2) + "\n")
process.exit(1)
