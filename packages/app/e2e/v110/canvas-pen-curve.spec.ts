/* SPDX-License-Identifier: MIT */

// ADR-039 (#113) — pen parity with the mockup (HTML L23203/L23298):
// click-drag creates symmetric Bezier handles, clicking the first anchor
// closes the path (an explicit final segment — the subset has no `Z`), and
// Enter still finishes an open path.

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { track } from "./gate"

const DOCUMENT_KEY = "unifia-design-document:v1:canvas"

const EMPTY = { schemaVersion: 1, id: "canvas", name: "Canvas", rootIds: [], nodes: {} }

function readPaths(page: import("@playwright/test").Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      nodes?: Record<string, { type?: string; d?: string; transform?: { x: number; y: number; width: number; height: number } }>
    }
    return Object.values(parsed.nodes ?? {})
      .filter((node) => node.type === "path")
      .map((node) => ({ d: node.d, transform: node.transform }))
  }, DOCUMENT_KEY)
}

test("pen drag draws curves and clicking the first anchor closes the path", async ({ page, directory, backend }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedStorage(page, { directory, model: backend.model, serverUrl: backend.url })
  await page.addInitScript(
    ([key, seed]) => {
      // Only seed the first load: a reload must come back from what was saved.
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, JSON.stringify(seed))
    },
    [DOCUMENT_KEY, EMPTY] as const,
  )
  await page.goto(`${dirPath(directory)}/design`)

  const t = track(page)
  await page.locator("[data-design-open-canvas]").click()
  await expect(page.locator("[data-design-canvas]")).toHaveAttribute("data-design-canvas-status", "ready")
  const surface = page.locator("[data-design-canvas] canvas").first()
  await expect.poll(async () => (await surface.boundingBox())?.width ?? 0, { message: "canvas must be laid out" })
    .toBeGreaterThan(400)
  const box = await surface.boundingBox()
  if (!box) return
  const at = (x: number, y: number) => ({ x: box.x + x, y: box.y + y })

  // Curve: press at (200,300), drag to (250,300) for a (50,0) symmetric
  // handle, release; then a corner click at (350,400) and Enter.
  await page.locator('[data-design-tool="pen"]').click()
  await page.mouse.move(at(200, 300).x, at(200, 300).y)
  await page.mouse.down()
  await page.mouse.move(at(250, 300).x, at(250, 300).y, { steps: 6 })
  await page.mouse.up()
  await page.mouse.click(at(350, 400).x, at(350, 400).y)
  await page.keyboard.press("Enter")
  await expect
    .poll(() => readPaths(page), { message: "the dragged pen point must become a cubic segment" })
    .toEqual([{ d: "M 0 0 C 50 0 150 100 150 100", transform: { x: 200, y: 300, width: 150, height: 100, rotation: 0 } }])

  // Closed shape: three corners then a click back on the first anchor.
  await page.mouse.click(at(200, 500).x, at(200, 500).y)
  await page.mouse.click(at(300, 500).x, at(300, 500).y)
  await page.mouse.click(at(280, 560).x, at(280, 560).y)
  await page.mouse.click(at(200, 500).x, at(200, 500).y)
  await expect
    .poll(() => readPaths(page), { message: "clicking the first anchor must close the path" })
    .toEqual([
      { d: "M 0 0 C 50 0 150 100 150 100", transform: { x: 200, y: 300, width: 150, height: 100, rotation: 0 } },
      { d: "M 0 0 L 100 0 L 80 60 L 0 0", transform: { x: 200, y: 500, width: 100, height: 60, rotation: 0 } },
    ])

  // The closed shape round-trips through a reload.
  await page.reload()
  const open = page.locator("[data-design-open-canvas]")
  const rows = page.locator("[data-design-layer-row]")
  await expect(open.or(rows.first()).first()).toBeVisible()
  if (await open.count()) await open.click()
  await expect(rows).toHaveCount(2)
  await expect
    .poll(() => readPaths(page), { message: "both paths must survive a reload" })
    .toEqual([
      { d: "M 0 0 C 50 0 150 100 150 100", transform: { x: 200, y: 300, width: 150, height: 100, rotation: 0 } },
      { d: "M 0 0 L 100 0 L 80 60 L 0 0", transform: { x: 200, y: 500, width: 100, height: 60, rotation: 0 } },
    ])

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
