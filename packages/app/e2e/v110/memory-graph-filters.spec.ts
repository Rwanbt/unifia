/* SPDX-License-Identifier: MIT */

// Phase 9.6: the Memory graph honours the mockup's filter set (module m69):
// depth cycles 1 to 3 from the selected note, tags add an outer tag ring,
// orphans filters edge-less nodes, and the summary counts the visible
// subgraph. Links and tags come from the real note bodies on disk.

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

test("memory graph filters: depth cycle, tag ring and orphans toggle", async ({ page, gotoSession, directory }) => {
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
    const nodes = page.locator("[data-memory-graph-node]")
    const tags = page.locator("[data-memory-graph-tag]")
    const depth = page.locator("[data-memory-graph-depth]")
    const summary = page.locator("[data-memory-graph-summary]")

    // Mockup defaults: depth 2 reaches a - b - c, tags alpha/beta render.
    await expect(depth).toHaveText("Depth 2")
    await expect(nodes).toHaveCount(3)
    await expect(tags).toHaveCount(2)
    await expect(summary).toHaveText("3 notes · 2 links")

    // Depth 1 keeps only the direct neighbour.
    await depth.click()
    await expect(depth).toHaveText("Depth 3")
    await depth.click()
    await expect(depth).toHaveText("Depth 1")
    await expect(nodes).toHaveCount(2)
    await expect(summary).toHaveText("2 notes · 1 links")
    await depth.click()
    await expect(depth).toHaveText("Depth 2")

    // Tags toggle removes the outer ring; orphans stays on by default.
    await page.locator("[data-memory-graph-tags]").click()
    await expect(tags).toHaveCount(0)
    await expect(page.locator("[data-memory-graph-orphans]")).toHaveAttribute("aria-pressed", "true")
  } finally {
    for (const note of Object.values(NOTES)) await rm(join(directory, note.path), { force: true })
  }
})