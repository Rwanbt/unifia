/* SPDX-License-Identifier: MIT */

// ADR-039 slice 5 (#108, partial) — the legacy Excalidraw sketch migrates
// into the canonical document through the validated importer:
//
//   * the Import action converts the stored sketch into canonical nodes,
//   * the legacy bytes are preserved untouched,
//   * unsupported elements are surfaced, never guessed away.

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { track } from "./gate"

const LEGACY_KEY = "unifia-design-sketch:v1:sketch"
const DOCUMENT_KEY = "unifia-design-document:v1:canvas"

const LEGACY = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    {
      id: "legacy-rect",
      type: "rectangle",
      x: 30,
      y: 40,
      width: 120,
      height: 90,
      angle: 0,
      strokeColor: "#334155",
      backgroundColor: "#e2e8f0",
      strokeWidth: 2,
      opacity: 100,
    },
    { id: "legacy-text", type: "text", x: 30, y: 140, width: 100, height: 20, text: "Legacy", strokeColor: "#334155" },
    { id: "legacy-unknown", type: "magicframe", x: 0, y: 0, width: 10, height: 10 },
  ],
})

test("the legacy sketch imports into the canonical document and keeps its bytes", async ({
  page,
  directory,
  backend,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedStorage(page, { directory, model: backend.model, serverUrl: backend.url })
  await page.addInitScript(
    ([legacyKey, documentKey, legacy]) => {
      window.localStorage.setItem(legacyKey, legacy)
      window.localStorage.removeItem(documentKey)
    },
    [LEGACY_KEY, DOCUMENT_KEY, LEGACY] as const,
  )
  await page.goto(`${dirPath(directory)}/design`)

  const t = track(page)
  await page.locator("[data-design-open-canvas]").click()
  await expect(page.locator("[data-design-canvas]")).toHaveAttribute("data-design-canvas-status", "ready")

  await page.locator("[data-design-canvas-import-sketch]").click()

  // The canonical document receives the converted nodes on save.
  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const raw = window.localStorage.getItem(key)
          if (!raw) return null
          const parsed = JSON.parse(raw) as {
            schemaVersion?: number
            rootIds?: string[]
            nodes?: Record<string, { type?: string }>
          }
          return {
            schemaVersion: parsed.schemaVersion,
            rootIds: parsed.rootIds,
            rect: parsed.nodes?.["legacy-rect"]?.type,
            text: parsed.nodes?.["legacy-text"]?.type,
          }
        }, DOCUMENT_KEY),
      { message: "the imported nodes must persist canonically" },
    )
    .toEqual({ schemaVersion: 2, rootIds: ["legacy-rect", "legacy-text"], rect: "rectangle", text: "text" })

  // Unsupported elements are surfaced, never silently dropped.
  await expect(page.locator("[data-design-canvas-import-info]")).toContainText("Imported 2")
  await expect(page.locator("[data-design-canvas-import-info]")).toContainText("skipped 1")

  // The legacy snapshot keeps its exact bytes.
  const legacyAfter = await page.evaluate((key) => window.localStorage.getItem(key), LEGACY_KEY)
  expect(legacyAfter).toBe(LEGACY)

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
