/* SPDX-License-Identifier: MIT */

// ADR-039 slice 2 (#105) — the native design canvas is the primary editable
// surface for the canonical design document:
//
//   * the Canvas tab mounts the Konva-backed surface (no /design-sketch iframe),
//   * a stored canonical document renders,
//   * a drag commits one typed transform command and persists it through the
//     repository contract (localStorage web fallback).
//
// The document is seeded before the app boots so the test proves load, render,
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

function readTransformX(page: import("@playwright/test").Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { nodes?: Record<string, { transform?: { x?: number } }> }
    return parsed.nodes?.r1?.transform?.x ?? null
  }, STORAGE_KEY)
}

function readTransform(page: import("@playwright/test").Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      nodes?: Record<string, { transform?: { x: number; y: number; width: number; height: number } }>
    }
    return parsed.nodes?.r1?.transform ?? null
  }, STORAGE_KEY)
}

test("native design canvas renders and persists a drag as a canonical command", async ({ page, directory, backend }) => {
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

  await expect.poll(() => readTransformX(page), { message: "the drag must persist a canonical transform" })
    .toBeGreaterThan(45)

  // Resize: click the rectangle to select it, then drag its bottom-right
  // transformer anchor. With pan 0 / zoom 1 the anchor sits exactly on the
  // canonical bottom-right corner in stage coordinates.
  const moved = await readTransform(page)
  expect(moved, "the drag must leave a canonical transform behind").not.toBeNull()
  if (!moved) return
  await page.mouse.click(box.x + moved.x + moved.width / 2, box.y + moved.y + moved.height / 2)
  await page.mouse.move(box.x + moved.x + moved.width, box.y + moved.y + moved.height)
  await page.mouse.down()
  await page.mouse.move(box.x + moved.x + moved.width + 60, box.y + moved.y + moved.height + 40, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await readTransform(page))?.width ?? 0, { message: "the resize must persist" })
    .toBeGreaterThan(moved.width + 30)

  // Rotate: the handle sits 50px above the top edge at zoom 1. The shape is
  // still selected (anchor clicks no longer clear the selection).
  const resized = await readTransform(page)
  expect(resized, "the resize must leave a canonical transform behind").not.toBeNull()
  if (!resized) return
  await page.mouse.move(box.x + resized.x + resized.width / 2, box.y + resized.y - 50)
  await page.mouse.down()
  await page.mouse.move(box.x + resized.x + resized.width + 80, box.y + resized.y + resized.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => (await readTransform(page))?.rotation ?? 0, { message: "the rotation must persist" })
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
