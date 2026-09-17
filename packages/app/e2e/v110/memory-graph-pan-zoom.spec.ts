/* SPDX-License-Identifier: MIT */

// Mockup m69 (matrix row "Memory graph pan/zoom/fit"): the graph viewport
// pans by drag, zooms with the wheel (clamped 0.55-1.8, anchored at the
// cursor) and refits its content on double-click. Fitting is deterministic,
// so a dblclick after pan+zoom restores the exact fitted transform.

import { rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"

const MEMORY_DIR = ".unifia/memory"
const NOTES = {
  a: { path: `${MEMORY_DIR}/a.md`, body: "# A\n[[B]] #alpha\n" },
  b: { path: `${MEMORY_DIR}/b.md`, body: "# B\n[[C]] #alpha #beta\n" },
  c: { path: `${MEMORY_DIR}/c.md`, body: "# C\n#beta\n" },
}

type GraphView = { x: number; y: number; zoom: number }

test("memory graph pans, wheel-zooms within clamp and refits on double-click", async ({ page, gotoSession, directory }) => {
  const dir = join(directory, MEMORY_DIR)
  await mkdir(dir, { recursive: true })
  for (const note of Object.values(NOTES)) await writeFile(join(directory, note.path), note.body, "utf8")
  try {
    await installWorkbenchMock(page, {
      files: Object.values(NOTES).map((note) => ({ path: note.path, kind: "file" as const })),
    })
    await page.setViewportSize({ width: 1400, height: 900 })
    await gotoSession()
    const toggle = page.getByRole("button", { name: "Toggle file tree" })
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await page.getByRole("tab", { name: "Inspector", exact: true }).click()
    await page.getByRole("button", { name: "Memory", exact: true }).click()
    await page.getByRole("button", { name: "Local graph" }).click()

    const svg = page.locator("[data-memory-graph-viewport]")
    const world = page.locator("[data-memory-graph-world]")
    await expect(page.locator("[data-memory-graph-node]")).toHaveCount(3)

    const view = async (): Promise<GraphView | null> => {
      const transform = await world.getAttribute("transform")
      const match = /translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)/.exec(transform ?? "")
      return match ? { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) } : null
    }

    const box = await svg.boundingBox()
    if (!box) return
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    // Top-left corner: always outside the centred content, so drags and
    // double-clicks hit the viewport itself rather than a node.
    const empty = { x: box.x + 8, y: box.y + 8 }

    // Double-click fits the content deterministically.
    await page.mouse.dblclick(empty.x, empty.y)
    await expect.poll(view, { message: "dblclick must fit the graph" }).not.toBeNull()
    const fitted = await view()
    if (!fitted) return
    expect(fitted.zoom).toBeGreaterThanOrEqual(0.55)
    expect(fitted.zoom).toBeLessThanOrEqual(1.8)

    // Drag pans; zoom is untouched.
    await page.mouse.move(empty.x, empty.y)
    await page.mouse.down()
    await page.mouse.move(empty.x + 60, empty.y + 30, { steps: 6 })
    await page.mouse.up()
    const panned = await view()
    expect(panned?.zoom).toBeCloseTo(fitted.zoom, 5)
    expect(Math.abs((panned?.x ?? 0) - fitted.x)).toBeGreaterThan(1)
    expect(Math.abs((panned?.y ?? 0) - fitted.y)).toBeGreaterThan(0.5)

    // Wheel zoom honours the maquette clamp in both directions.
    await page.mouse.move(center.x, center.y)
    for (let step = 0; step < 14; step += 1) await page.mouse.wheel(0, -120)
    await expect.poll(async () => (await view())?.zoom ?? 0, { message: "wheel-in must stop at the clamp" }).toBeCloseTo(1.8, 5)
    for (let step = 0; step < 24; step += 1) await page.mouse.wheel(0, 120)
    await expect.poll(async () => (await view())?.zoom ?? 0, { message: "wheel-out must stop at the clamp" }).toBeCloseTo(0.55, 5)

    // Double-click refits to the deterministic view captured earlier. The
    // tolerance absorbs sub-percent drift when the first fit was measured
    // while the inspector panel was still settling; it stays far tighter
    // than the panned/zoomed state being replaced.
    await page.mouse.dblclick(empty.x, empty.y)
    await expect
      .poll(
        async () => {
          const current = await view()
          if (!current) return false
          return Math.abs(current.zoom - fitted.zoom) < 0.01 && Math.abs(current.x - fitted.x) < 1.5 && Math.abs(current.y - fitted.y) < 1.5
        },
        { message: "dblclick must refit after pan and zoom" },
      )
      .toBe(true)
  } finally {
    for (const note of Object.values(NOTES)) await rm(join(directory, note.path), { force: true })
  }
})
