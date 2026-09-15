/* SPDX-License-Identifier: MIT */

// ADR-039 slice 2 (#105) and slice 3 (#106) — the native design canvas is the
// primary editable surface for the canonical design document:
//
//   * the Canvas tab mounts the Konva-backed surface (no /design-sketch iframe),
//   * a stored canonical document renders,
//   * drag / resize / rotate commit typed transform commands and persist them
//     through the repository contract (localStorage web fallback),
//   * a drag snaps to sibling edges, one gesture is one history entry, and a
//     single undo/redo round-trips the canonical document.
//
// Documents are seeded before the app boots so the tests prove load, render,
// interaction and persistence — not a UI fabrication of any of them.

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { track } from "./gate"

const STORAGE_KEY = "unifia-design-document:v1:canvas"

const SEED = {
  schemaVersion: 1,
  id: "canvas",
  name: "Canvas",
  rootIds: ["r1"],
  nodes: {
    r1: {
      id: "r1",
      name: "r1",
      parentId: null,
      visible: true,
      locked: false,
      type: "rectangle",
      transform: { x: 40, y: 40, width: 100, height: 80, rotation: 0 },
    },
  },
}

const SNAP_SEED = {
  schemaVersion: 1,
  id: "canvas",
  name: "Canvas",
  rootIds: ["r1", "r2"],
  nodes: {
    ...SEED.nodes,
    r2: {
      id: "r2",
      name: "r2",
      parentId: null,
      visible: true,
      locked: false,
      type: "rectangle",
      transform: { x: 240, y: 240, width: 100, height: 80, rotation: 0 },
    },
  },
}

type Rect = { x: number; y: number; width: number; height: number; rotation: number }

function readNodeTransform(page: import("@playwright/test").Page, id: string) {
  return page.evaluate(
    ([key, nodeId]) => {
      const raw = window.localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { nodes?: Record<string, { transform?: Rect }> }
      return parsed.nodes?.[nodeId]?.transform ?? null
    },
    [STORAGE_KEY, id] as const,
  )
}

function readNodeX(page: import("@playwright/test").Page, id: string) {
  return readNodeTransform(page, id).then((transform) => transform?.x ?? null)
}

test("native design canvas renders and persists drag, resize and rotation", async ({ page, directory, backend }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedStorage(page, { directory, model: backend.model, serverUrl: backend.url })
  await page.addInitScript(
    ([key, seed]) => {
      window.localStorage.setItem(key, JSON.stringify(seed))
    },
    [STORAGE_KEY, SEED] as const,
  )
  await page.goto(`${dirPath(directory)}/design`)

  const t = track(page)
  await page.locator("[data-design-open-canvas]").click()

  const canvas = page.locator("[data-design-canvas]")
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute("data-design-canvas-status", "ready")

  const surface = canvas.locator("canvas").first()
  await expect(surface).toBeVisible()
  await expect.poll(async () => (await surface.boundingBox())?.width ?? 0, { message: "canvas must be laid out" })
    .toBeGreaterThan(400)

  const box = await surface.boundingBox()
  expect(box, "canvas must have a laid-out box").not.toBeNull()
  if (!box) return

  // The seeded rectangle spans (40,40)-(140,120); pan/zoom start at 0/1 so
  // its centre is the canvas-local point (90,80).
  await page.mouse.move(box.x + 90, box.y + 80)
  await page.mouse.down()
  await page.mouse.move(box.x + 150, box.y + 120, { steps: 8 })
  await page.mouse.up()

  await expect.poll(() => readNodeX(page, "r1"), { message: "the drag must persist a canonical transform" })
    .toBeGreaterThan(45)

  // Resize: click the rectangle to select it, then drag its bottom-right
  // transformer anchor. With pan 0 / zoom 1 the anchor sits exactly on the
  // canonical bottom-right corner in stage coordinates.
  const moved = await readNodeTransform(page, "r1")
  expect(moved, "the drag must leave a canonical transform behind").not.toBeNull()
  if (!moved) return
  await page.mouse.click(box.x + moved.x + moved.width / 2, box.y + moved.y + moved.height / 2)
  await page.mouse.move(box.x + moved.x + moved.width, box.y + moved.y + moved.height)
  await page.mouse.down()
  await page.mouse.move(box.x + moved.x + moved.width + 60, box.y + moved.y + moved.height + 40, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await readNodeTransform(page, "r1"))?.width ?? 0, { message: "the resize must persist" })
    .toBeGreaterThan(moved.width + 30)

  // Rotate: the handle sits 50px above the top edge at zoom 1. The shape is
  // still selected (anchor clicks no longer clear the selection).
  const resized = await readNodeTransform(page, "r1")
  expect(resized, "the resize must leave a canonical transform behind").not.toBeNull()
  if (!resized) return
  await page.mouse.move(box.x + resized.x + resized.width / 2, box.y + resized.y - 50)
  await page.mouse.down()
  await page.mouse.move(box.x + resized.x + resized.width + 80, box.y + resized.y + resized.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => (await readNodeTransform(page, "r1"))?.rotation ?? 0, { message: "the rotation must persist" })
    .not.toBe(0)

  // The persisted document is still the canonical v1 shape (no renderer state).
  const persisted = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    const parsed = JSON.parse(raw ?? "{}") as { schemaVersion?: number; nodes?: Record<string, { type?: string }> }
    return { schemaVersion: parsed.schemaVersion, type: parsed.nodes?.r1?.type }
  }, STORAGE_KEY)
  expect(persisted).toEqual({ schemaVersion: 1, type: "rectangle" })

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})

test("dragging a sibling snaps to its edge and one undo restores the gesture", async ({ page, directory, backend }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedStorage(page, { directory, model: backend.model, serverUrl: backend.url })
  await page.addInitScript(
    ([key, seed]) => {
      window.localStorage.setItem(key, JSON.stringify(seed))
    },
    [STORAGE_KEY, SNAP_SEED] as const,
  )
  await page.goto(`${dirPath(directory)}/design`)

  const t = track(page)
  await page.locator("[data-design-open-canvas]").click()
  const canvas = page.locator("[data-design-canvas]")
  await expect(canvas).toHaveAttribute("data-design-canvas-status", "ready")
  const surface = canvas.locator("canvas").first()
  await expect.poll(async () => (await surface.boundingBox())?.width ?? 0).toBeGreaterThan(400)
  const box = await surface.boundingBox()
  if (!box) return

  // r2 spans (240,240)-(340,320). Dragging it 95px left lands its left edge at
  // 145 — 5px from r1's right edge (140), inside the 8px threshold — so the
  // commit must land exactly on 140.
  await page.mouse.move(box.x + 290, box.y + 280)
  await page.mouse.down()
  await page.mouse.move(box.x + 195, box.y + 280, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => readNodeX(page, "r2"), { message: "the sibling edge must snap" }).toBe(140)

  // One gesture = one history entry: a single undo restores the seed position,
  // a single redo returns to the snapped one.
  await page.keyboard.press("Control+z")
  await expect.poll(() => readNodeX(page, "r2"), { message: "one undo must restore the pre-gesture document" }).toBe(240)
  await page.keyboard.press("Control+y")
  await expect.poll(() => readNodeX(page, "r2"), { message: "one redo must reapply the gesture" }).toBe(140)

  // Keyboard nudge: click to select, one arrow key is one gesture.
  await page.mouse.click(box.x + 190, box.y + 280)
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => readNodeX(page, "r2"), { message: "the nudge must persist" }).toBe(141)
  await page.keyboard.press("Control+z")
  await expect.poll(() => readNodeX(page, "r2"), { message: "one undo must revert the nudge" }).toBe(140)

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
