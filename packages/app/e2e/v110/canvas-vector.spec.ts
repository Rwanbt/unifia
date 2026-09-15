/* SPDX-License-Identifier: MIT */

// ADR-039 (#109, slice 1) — vector creation tools on the native canvas:
// drag-to-draw ellipse and line plus click-to-point pen paths all land as
// canonical nodes through the normal insertNode command, and the draft
// preview never reaches the stored document.

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { track } from "./gate"

const DOCUMENT_KEY = "unifia-design-document:v1:canvas"

const EMPTY = { schemaVersion: 1, id: "canvas", name: "Canvas", rootIds: [], nodes: {} }

function findNode(page: import("@playwright/test").Page, type: string) {
  return page.evaluate(
    ([key, nodeType]) => {
      const raw = window.localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { nodes?: Record<string, unknown> }
      return Object.values(parsed.nodes ?? {}).find((node) => (node as { type?: string }).type === nodeType) ?? null
    },
    [DOCUMENT_KEY, type] as const,
  )
}

test("vector tools draw canonical ellipse, line and pen nodes on the canvas", async ({ page, directory, backend }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedStorage(page, { directory, model: backend.model, serverUrl: backend.url })
  await page.addInitScript(
    ([key, seed]) => {
      window.localStorage.setItem(key, JSON.stringify(seed))
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

  // Ellipse: drag from (100,100) to (220,180).
  await page.locator('[data-design-tool="ellipse"]').click()
  await page.mouse.move(box.x + 100, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 220, box.y + 180, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() => findNode(page, "ellipse"), { message: "the ellipse draft must become a canonical node" })
    .toMatchObject({ transform: { x: 100, y: 100, width: 120, height: 80, rotation: 0 } })

  // Line: drag from (300,300) to (360,340).
  await page.locator('[data-design-tool="line"]').click()
  await page.mouse.move(box.x + 300, box.y + 300)
  await page.mouse.down()
  await page.mouse.move(box.x + 360, box.y + 340, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() => findNode(page, "line"), { message: "the line draft must become a canonical node" })
    .toMatchObject({
      transform: { x: 300, y: 300, width: 60, height: 40, rotation: 0 },
      points: [
        { x: 0, y: 0 },
        { x: 60, y: 40 },
      ],
    })

  // Pen: three clicks then Enter closes the path.
  await page.locator('[data-design-tool="pen"]').click()
  await page.mouse.click(box.x + 400, box.y + 400)
  await page.mouse.click(box.x + 460, box.y + 400)
  await page.mouse.click(box.x + 460, box.y + 460)
  await page.keyboard.press("Enter")
  await expect
    .poll(() => findNode(page, "path"), { message: "the pen draft must become a canonical path" })
    .toMatchObject({
      transform: { x: 400, y: 400, width: 60, height: 60, rotation: 0 },
      d: "M 0 0 L 60 0 L 60 60",
    })

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
