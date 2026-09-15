/* SPDX-License-Identifier: MIT */

// ADR-039 (#110, slice 1) — polyline anchor editing on the native canvas:
// selecting a path node shows its anchors, dragging one previews locally and
// commits a typed `updatePoints` command; the stored path data and bounding
// box are rewritten deterministically.

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { track } from "./gate"

const DOCUMENT_KEY = "unifia-design-document:v1:canvas"

const SEED = {
  schemaVersion: 1,
  id: "canvas",
  name: "Canvas",
  rootIds: ["p1"],
  nodes: {
    p1: {
      id: "p1",
      name: "p1",
      parentId: null,
      visible: true,
      locked: false,
      type: "path",
      transform: { x: 400, y: 400, width: 60, height: 60, rotation: 0 },
      d: "M 0 0 L 60 0 L 60 60",
    },
  },
}

function readPath(page: import("@playwright/test").Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      nodes?: Record<string, { d?: string; transform?: { x: number; y: number; width: number; height: number } }>
    }
    const node = parsed.nodes?.p1
    return node ? { d: node.d, transform: node.transform } : null
  }, DOCUMENT_KEY)
}

test("dragging a path anchor rewrites the canonical path data", async ({ page, directory, backend }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedStorage(page, { directory, model: backend.model, serverUrl: backend.url })
  await page.addInitScript(
    ([key, seed]) => {
      window.localStorage.setItem(key, JSON.stringify(seed))
    },
    [DOCUMENT_KEY, SEED] as const,
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

  // Select the path through the Layers panel (deterministic, no stroke hit test).
  await page.locator('[data-design-layer-row="p1"]').click()

  // Drag the first anchor from (400,400) to (430,370).
  await page.mouse.move(box.x + 400, box.y + 400)
  await page.mouse.down()
  await page.mouse.move(box.x + 430, box.y + 370, { steps: 8 })
  await page.mouse.up()

  await expect
    .poll(() => readPath(page), { message: "the anchor drag must rewrite the canonical path" })
    .toEqual({
      d: "M 0 0 L 30 30 L 30 90",
      transform: { x: 430, y: 370, width: 30, height: 90, rotation: 0 },
    })

  // One gesture = one history entry: undo restores the seeded path, redo
  // reapplies the edit.
  await page.keyboard.press("Control+z")
  await expect
    .poll(() => readPath(page), { message: "one undo must restore the previous path" })
    .toEqual({
      d: "M 0 0 L 60 0 L 60 60",
      transform: { x: 400, y: 400, width: 60, height: 60, rotation: 0 },
    })
  await page.keyboard.press("Control+y")
  await expect
    .poll(() => readPath(page), { message: "one redo must reapply the edit" })
    .toEqual({
      d: "M 0 0 L 30 30 L 30 90",
      transform: { x: 430, y: 370, width: 30, height: 90, rotation: 0 },
    })

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
