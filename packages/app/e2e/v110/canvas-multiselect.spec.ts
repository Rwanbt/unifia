/* SPDX-License-Identifier: MIT */

// ADR-039 (#112) — multi-select on the native canvas: modifier clicks toggle
// nodes in and out (a selection never mixes a container with its children),
// an empty-space drag draws a marquee over the world AABB of every visible
// node, and one group drag commits a single `translateNodes` command — one
// undo entry for the whole gesture. Panning moved to Space-drag / middle-drag.
//
// The seed keeps every node inside the visible canvas (~680x740 CSS px), so
// gestures never leave the stage element.

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { track } from "./gate"

const DOCUMENT_KEY = "unifia-design-document:v1:canvas"

const rect = (x: number, y: number, width: number, height: number, rotation = 0) => ({
  transform: { x, y, width, height, rotation },
})

const SEED = {
  schemaVersion: 1,
  id: "canvas",
  name: "Canvas",
  rootIds: ["a", "b", "r"],
  nodes: {
    a: { id: "a", name: "a", parentId: null, visible: true, locked: false, type: "rectangle", ...rect(120, 200, 100, 60) },
    b: { id: "b", name: "b", parentId: null, visible: true, locked: false, type: "rectangle", ...rect(280, 200, 100, 60) },
    r: { id: "r", name: "r", parentId: null, visible: true, locked: false, type: "rectangle", ...rect(420, 180, 100, 100, 45) },
  },
}

function readRect(page: import("@playwright/test").Page, id: string) {
  return page.evaluate(
    ([key, nodeId]) => {
      const raw = window.localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { nodes?: Record<string, { transform?: { x: number; y: number } }> }
      const node = parsed.nodes?.[nodeId]
      return node?.transform ? { x: node.transform.x, y: node.transform.y } : null
    },
    [DOCUMENT_KEY, id] as const,
  )
}

test("modifier clicks, marquee and group drag commit one multi-move", async ({ page, directory, backend }) => {
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
  const at = (x: number, y: number) => ({ x: box.x + x, y: box.y + y })
  const selection = page.locator("[data-design-canvas-tab]")

  // Modifier clicks: plain click selects, Shift-click toggles.
  await page.mouse.click(at(170, 230).x, at(170, 230).y)
  await expect(selection).toHaveAttribute("data-design-canvas-selection", "a")
  await page.keyboard.down("Shift")
  await page.mouse.click(at(330, 230).x, at(330, 230).y)
  await page.keyboard.up("Shift")
  await expect(selection).toHaveAttribute("data-design-canvas-selection", "a,b")
  await page.keyboard.down("Shift")
  await page.mouse.click(at(330, 230).x, at(330, 230).y)
  await page.keyboard.up("Shift")
  await expect(selection).toHaveAttribute("data-design-canvas-selection", "a")
  await page.keyboard.down("Shift")
  await page.mouse.click(at(330, 230).x, at(330, 230).y)
  await page.keyboard.up("Shift")
  await expect(selection).toHaveAttribute("data-design-canvas-selection", "a,b")

  // One group drag moves both nodes; one undo restores both.
  await page.mouse.move(at(170, 230).x, at(170, 230).y)
  await page.mouse.down()
  await page.mouse.move(at(210, 270).x, at(210, 270).y, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => readRect(page, "a"), { message: "the leader must move" }).toEqual({ x: 160, y: 240 })
  await expect.poll(() => readRect(page, "b"), { message: "the follower must move by the same delta" }).toEqual({ x: 320, y: 240 })
  await page.keyboard.press("Control+z")
  await expect.poll(() => readRect(page, "a"), { message: "one undo must restore the leader" }).toEqual({ x: 120, y: 200 })
  await expect.poll(() => readRect(page, "b"), { message: "one undo must restore the follower" }).toEqual({ x: 280, y: 200 })
  await page.keyboard.press("Control+y")
  await expect.poll(() => readRect(page, "b"), { message: "redo must reapply the group move" }).toEqual({ x: 320, y: 240 })
  await page.keyboard.press("Control+z")
  await expect.poll(() => readRect(page, "a")).toEqual({ x: 120, y: 200 })

  // Marquee over both rects, staying clear of the rotated node's AABB.
  await page.mouse.click(at(80, 500).x, at(80, 500).y)
  await expect(selection).toHaveAttribute("data-design-canvas-selection", "")
  await page.mouse.move(at(100, 180).x, at(100, 180).y)
  await page.mouse.down()
  await page.mouse.move(at(390, 280).x, at(390, 280).y, { steps: 10 })
  await page.mouse.up()
  await expect(selection).toHaveAttribute("data-design-canvas-selection", "a,b")

  // The rotated node is picked through its world AABB: this marquee touches
  // the AABB's top-left corner only — outside the rotated square itself — and
  // still selects it.
  await page.mouse.move(at(400, 160).x, at(400, 160).y)
  await page.mouse.down()
  await page.mouse.move(at(410, 170).x, at(410, 170).y, { steps: 4 })
  await page.mouse.up()
  await expect(selection).toHaveAttribute("data-design-canvas-selection", "r")

  // A plain click on a node replaces the selection; the node stays selected.
  await page.mouse.click(at(170, 230).x, at(170, 230).y)
  await expect(selection).toHaveAttribute("data-design-canvas-selection", "a")

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
