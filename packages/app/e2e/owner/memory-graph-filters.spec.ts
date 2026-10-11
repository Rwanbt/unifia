/* SPDX-License-Identifier: MIT */

// Phase 9.6: the Memory graph honours the mockup's filter set (module m69): depth cycles 1 to 3 from the selected note,
// tags add an outer tag ring, orphans filters edge-less nodes, and the summary counts the visible subgraph. Links and
// tags come from the governed note bodies the owner's routes return.

import { test, expect } from "../fixtures"
import { openMemoryPanel, writeGovernedVault } from "../memory-vault"
import { GRAPH_NOTES } from "./graph-notes"

test.use({ backendIsolation: "owner" })

test("memory graph filters: depth cycle, tag ring and orphans toggle", async ({ page, project }) => {
  await project.open({ setup: (directory) => writeGovernedVault(directory, GRAPH_NOTES) })
  await openMemoryPanel(page)

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
})
