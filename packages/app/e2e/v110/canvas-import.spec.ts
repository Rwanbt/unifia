/* SPDX-License-Identifier: MIT */

// ADR-039 slice 5 (#108, partial) — the legacy Excalidraw sketch migrates
// into the canonical document through the validated importer:
//
//   * the Import action converts the stored sketch into canonical nodes,
//   * the legacy bytes are preserved untouched,
//   * unsupported elements are surfaced, never guessed away.

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { track, trackFailingRequests, unexpectedRequests } from "./gate"
import fs from "node:fs/promises"
import { join } from "node:path"

// The canvas document is workspace-backed (design-canvas-tab.tsx composes an SDK
// file store over the localStorage repository), the id is the hardcoded "canvas",
// and `directory` is scope:"worker" - so a document left by another spec or an
// earlier run is present, wins over the localStorage seed, and makes this
// assertion read a document that never contained the imported nodes. See
// docs/audit/RC0-CANVAS-STORE-ORACLE.md.
async function resetWorkspaceCanvas(directory: string) {
  await fs.rm(join(directory, ".unifia", "design", "canvas.design.json"), { force: true })
}

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
  await resetWorkspaceCanvas(directory)
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
  const req = trackFailingRequests(page)
  // ADR-085: Design opens on the canvas studio, no tab to click.
  await expect(page.locator("[data-design-canvas]")).toHaveAttribute("data-design-canvas-status", "ready")

  await page.locator("[data-design-canvas-import-sketch]").click()

  // The canonical document receives the converted nodes on save — and it is
  // saved to the workspace, so that is the file to read back. The localStorage
  // copy is only refreshed when a workspace write fails.
  await expect
    .poll(
      async () => {
        const raw = await fs
          .readFile(join(directory, ".unifia", "design", "canvas.design.json"), "utf8")
          .catch(() => "")
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
      },
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
// Chromium reports every failed resource with the same text and no URL, so the
// console line alone cannot name which request 404'd. Gate on the requests
// instead — anything but the two documented harness 404s fails — and keep failing
// on any other console error. See BENIGN_HARNESS_404 in ./gate.
expect(unexpectedRequests(req.bad), "failing requests: " + req.bad.join(" | ")).toEqual([])
expect(
  t.logs.filter((entry) => !entry.includes("status of 404")),
  "console errors: " + t.logs.join(" | "),
).toEqual([])
})
