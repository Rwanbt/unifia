/* SPDX-License-Identifier: MIT */

// ADR-039 (#111, slice 1) — curve editing on the native canvas: selecting a
// path shows its anchors and Bezier control handles (tethered by guide
// lines), dragging a control commits a typed `updatePath` command, and the
// stored data round-trips through a reload.

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { CANVAS_DOCUMENT_STORAGE_KEY, readCanvasDocument, resetWorkspaceCanvas } from "./canvas-document"
import { expectNoErrorsBeyondHarness404s, track, trackFailingRequests } from "./gate"

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
      d: "M 0 0 Q 30 30 60 60",
    },
  },
}

async function readPath(directory: string) {
  const document = await readCanvasDocument<{
    nodes?: Record<string, { d?: string; transform?: { x: number; y: number; width: number; height: number } }>
  }>(directory)
  const node = document?.nodes?.p1
  return node ? { d: node.d, transform: node.transform } : null
}

test("dragging a pull handle rewrites the canonical curve and survives a reload", async ({ page, directory, backend }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedStorage(page, { directory, model: backend.model, serverUrl: backend.url })
  await page.addInitScript(
    ([key, seed]) => {
      // Only seed the first load: a reload must come back from what was saved.
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, JSON.stringify(seed))
    },
    [CANVAS_DOCUMENT_STORAGE_KEY, SEED] as const,
  )
  await resetWorkspaceCanvas(directory)
  const requests = trackFailingRequests(page)
  await page.goto(`${dirPath(directory)}/design`)

  const t = track(page)
  // ADR-085: Design opens on the canvas studio, no tab to click.
  await expect(page.locator("[data-design-canvas]")).toHaveAttribute("data-design-canvas-status", "ready")
  const surface = page.locator("[data-design-canvas] canvas").first()
  await expect.poll(async () => (await surface.boundingBox())?.width ?? 0, { message: "canvas must be laid out" })
    .toBeGreaterThan(400)
  const box = await surface.boundingBox()
  if (!box) return

  // Select through the Layers panel, then drag the quadratic control from
  // world (430,430) down to (430,490): the curve dips and its tight bounds
  // grow to 67.5 while the top-left corner stays put.
  await page.locator('[data-design-layer-row="p1"]').click()
  await page.mouse.move(box.x + 430, box.y + 430)
  await page.mouse.down()
  await page.mouse.move(box.x + 430, box.y + 490, { steps: 8 })
  await page.mouse.up()

  const edited = {
    d: "M 0 0 Q 30 90 60 60",
    transform: { x: 400, y: 400, width: 60, height: 67.5, rotation: 0 },
  }
  await expect
    .poll(() => readPath(directory), { message: "the control drag must rewrite the canonical path" })
    .toEqual(edited)

  // One gesture = one history entry.
  await page.keyboard.press("Control+z")
  await expect
    .poll(() => readPath(directory), { message: "one undo must restore the seeded curve" })
    .toEqual({ d: "M 0 0 Q 30 30 60 60", transform: { x: 400, y: 400, width: 60, height: 60, rotation: 0 } })
  await page.keyboard.press("Control+y")
  await expect.poll(() => readPath(directory), { message: "one redo must reapply the edit" }).toEqual(edited)

  // Reload: the persisted curve must come back without a load-time rewrite.
  await page.reload()
  const open = page.locator("[data-design-open-canvas]")
  const row = page.locator('[data-design-layer-row="p1"]')
  await expect(open.or(row).first()).toBeVisible()
  if (await open.count()) await open.click()
  await expect(row).toBeVisible()
  await expect.poll(() => readPath(directory), { message: "the edited curve must survive a reload" }).toEqual(edited)

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expectNoErrorsBeyondHarness404s(t, requests)
})
