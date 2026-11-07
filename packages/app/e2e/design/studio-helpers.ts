/* SPDX-License-Identifier: MIT */

import type { Page } from "@playwright/test"
import { expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"
import { DESIGN_CANVAS_FILE, visualDocument } from "./design-content.fixture"
import { markE2E, seedServerUrl, waitForSurface } from "./surface"

// Shared driver for the studio-editing specs (#1063): a seeded canvas on a
// desktop viewport, where the owner reported the gaps, driven only through
// the controls a person uses.

export const DESKTOP = { width: 1280, height: 800 } as const

export async function seedCanvas(project: { open: (o: unknown) => Promise<void> }) {
  await project.open({
    beforeGoto: async ({ sdk }: { sdk: { file: { write: (o: unknown) => Promise<unknown> } } }) => {
      await sdk.file.write({ path: DESIGN_CANVAS_FILE, content: visualDocument("#e85a32") })
    },
  })
}

export async function openStudio(page: Page, directory: string, serverUrl: string) {
  await seedServerUrl(page, serverUrl)
  await page.setViewportSize(DESKTOP)
  await markE2E(page)
  await installWorkbenchMock(page)
  await page.goto(`${dirPath(directory)}/design`)
  await waitForSurface(page)
  await expect(page.locator('[data-design-canvas-status="ready"]')).toBeVisible()
}

export const layerRows = (page: Page) => page.locator("[data-design-layer-row]")

/** Drags on the canvas between two points given relative to its top-left corner. */
export async function dragOnCanvas(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const box = (await page.locator("[data-design-canvas]").boundingBox())!
  await page.mouse.move(box.x + from.x, box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 4 })
  await page.mouse.up()
}

/** Draws a rectangle with the dock tool; the new node ends up selected. */
export async function drawRectangle(page: Page, at: { x: number; y: number }) {
  await page.locator('[data-design-tool="rectangle"]').click()
  await dragOnCanvas(page, at, { x: at.x + 100, y: at.y + 60 })
  await page.locator('[data-design-tool="select"]').click()
}

/** Ids of the current selection, as the studio publishes them. */
export async function selectedIds(page: Page): Promise<string[]> {
  const raw = await page.locator("[data-design-canvas-tab]").getAttribute("data-design-canvas-selection")
  return raw ? raw.split(",").filter(Boolean) : []
}
