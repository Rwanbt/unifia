// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:pixel:diff -- screenshots the frozen maquette and the live app at
// the same viewport/theme/locale over an isolated CDP browser, and diffs
// them pixel-by-pixel with pixelmatch. This is the closest thing to the S1
// G2 visual engine (BrowserContext isolation, pixel engine) that this host
// can run: F0's Docker image is absent and chromium.launch() hangs here, so
// this reuses the same CDP-attach workaround runtime-pair.ts already proved
// deterministic, rather than waiting on the blocked infrastructure.
//
// Why node, not bun: same reason as runtime-pair.ts -- playwright's
// connectOverCDP times out under bun 1.3.14 on this host and succeeds under
// node 22.15. Run with `node --experimental-strip-types`.
//
// Not a CI gate: it needs an external browser (started per HANDOFF-CLAUDE.md
// §5, never on :9222) and the app's own dev servers running, none of which a
// CI runner has. It is a tool for a human or an agent doing pixel-parity
// work interactively, the same non-required role runtime-pair.ts plays
// through evidence-host's optionalGates.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type BrowserContext, type Page } from "playwright"
import { PNG } from "pngjs"
import pixelmatch from "pixelmatch"

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
const OUT_DIR = join(ROOT, "parity", "artifacts", "pixel-diff")

const args = process.argv.slice(2)
const arg = (name: string, fallback: string): string => {
  const hit = args.find((entry) => entry.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const flag = (name: string): boolean => args.includes(`--${name}`)

const maquetteUrl = arg("maquette", "")
const appUrl = arg("app", "")
const name = arg("name", "diff")
const cdp = arg("cdp", "http://127.0.0.1:9222")
const width = Number(arg("width", "1440"))
const height = Number(arg("height", "900"))
const theme = arg("theme", "dark")
const locale = arg("locale", "fr")
const threshold = Number(arg("threshold", "0.1"))
const hideDebugBar = !flag("keep-debug-bar")

if (!maquetteUrl || !appUrl) {
  process.stderr.write(
    "usage: pixel-diff.ts --maquette=<url> --app=<url> [--name=out] [--cdp=http://127.0.0.1:9333] " +
      "[--width=1440] [--height=900] [--theme=dark|light] [--locale=fr] [--threshold=0.1] [--keep-debug-bar]\n",
  )
  process.exit(1)
}

async function shoot(
  context: BrowserContext,
  url: string,
  readySelector: string | null,
  initFn?: (page: Page) => Promise<void>,
): Promise<Buffer> {
  const page = await context.newPage()
  try {
    await page.setViewportSize({ width, height })
    // Explicit, not ambient: a page can resolve "system" color scheme via
    // matchMedia when nothing is persisted, and headless Chromium's default
    // for that query is host-dependent. Forcing it removes that source of
    // nondeterminism from the diff.
    await page.emulateMedia({ colorScheme: theme === "light" ? "light" : "dark" })
    if (initFn) await initFn(page)
    await page.goto(url, { waitUntil: "load", timeout: 60000 })
    if (readySelector) {
      await page.waitForSelector(readySelector, { state: "attached", timeout: 20000 })
    }
    // A fixed wait is a known bug class in this codebase (HANDOFF-CLAUDE.md
    // §4 defect 2, fixed in runtime-pair.ts): a screenshot taken right after
    // the ready selector attaches can still land mid-reflow. Waiting for two
    // consecutive animation frames with no further layout thrash underway is
    // a real "the page settled" signal instead of a guessed delay.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )
    await page.waitForTimeout(300)
    return await page.screenshot()
  } finally {
    // Leaked pages accumulate across runs on a CDP-attached browser and
    // eventually fail future navigations with net::ERR_INSUFFICIENT_RESOURCES
    // -- the exact failure mode found and fixed in runtime-pair.ts.
    await page.close().catch(() => {})
  }
}

const browser = await chromium.connectOverCDP(cdp)
try {
  const context = browser.contexts()[0]
  if (!context) throw new Error("CDP browser exposed no context")

  const maquetteBuf = await shoot(context, maquetteUrl, null)
  const appBuf = await shoot(context, appUrl, null, async (page) => {
    await page.addInitScript(
      ({ colorKey, colorValue, langKey, langValue, hideDebug }) => {
        localStorage.setItem(colorKey, colorValue)
        localStorage.setItem(langKey, langValue)
        // Matches how the real e2e harness marks itself
        // (packages/app/src/testing/active.ts): layout.tsx only mounts
        // <DebugBar/> when this is falsy. Without it the dev FPS/frame-timing
        // overlay is permanent diff noise unrelated to the shipped UI.
        if (hideDebug) (window as unknown as { __opencode_e2e?: boolean }).__opencode_e2e = true
      },
      {
        colorKey: "unifia-color-scheme",
        colorValue: theme,
        langKey: "opencode.global.dat:language",
        langValue: JSON.stringify({ locale }),
        hideDebug: hideDebugBar,
      },
    )
  })

  const img1 = PNG.sync.read(maquetteBuf)
  const img2 = PNG.sync.read(appBuf)

  const w = Math.min(img1.width, img2.width)
  const h = Math.min(img1.height, img2.height)
  const sizeMismatch = img1.width !== img2.width || img1.height !== img2.height

  const diff = new PNG({ width: w, height: h })
  const diffPixels = pixelmatch(img1.data, img2.data, diff.data, w, h, { threshold })

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, `${name}-maquette.png`), maquetteBuf)
  writeFileSync(join(OUT_DIR, `${name}-app.png`), appBuf)
  writeFileSync(join(OUT_DIR, `${name}-diff.png`), PNG.sync.write(diff))

  const totalPixels = w * h
  const result = {
    name,
    maquette: { width: img1.width, height: img1.height },
    app: { width: img2.width, height: img2.height },
    compared: { width: w, height: h },
    sizeMismatch,
    diffPixels,
    totalPixels,
    diffPercent: `${((diffPixels / totalPixels) * 100).toFixed(2)}%`,
    artifacts: {
      maquette: join(OUT_DIR, `${name}-maquette.png`),
      app: join(OUT_DIR, `${name}-app.png`),
      diff: join(OUT_DIR, `${name}-diff.png`),
    },
  }
  writeFileSync(join(OUT_DIR, `${name}-result.json`), JSON.stringify(result, null, 2))
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
} finally {
  await browser.close().catch(() => {})
}
