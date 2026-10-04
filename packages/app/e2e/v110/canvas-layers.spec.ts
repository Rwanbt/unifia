/* SPDX-License-Identifier: MIT */

// ADR-039 slice 4 (#107) — the Layers panel is a view over the canonical
// hierarchy: visibility, lock, reorder and reparent all become typed commands,
// and the stored document stays the only ordering authority (no parallel
// layer model survives).

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { track } from "./gate"
import fs, { rm } from "node:fs/promises"
import { join } from "node:path"

const STORAGE_KEY = "unifia-design-document:v1:canvas"

const SEED = {
  schemaVersion: 1,
  id: "canvas",
  name: "Canvas",
  rootIds: ["f", "r"],
  nodes: {
    f: {
      id: "f",
      name: "Frame",
      parentId: null,
      visible: true,
      locked: false,
      type: "frame",
      transform: { x: 40, y: 40, width: 200, height: 200, rotation: 0 },
      childIds: ["a", "b"],
    },
    a: {
      id: "a",
      name: "a",
      parentId: "f",
      visible: true,
      locked: false,
      type: "rectangle",
      transform: { x: 20, y: 20, width: 50, height: 50, rotation: 0 },
    },
    b: {
      id: "b",
      name: "b",
      parentId: "f",
      visible: true,
      locked: false,
      type: "rectangle",
      transform: { x: 100, y: 20, width: 50, height: 50, rotation: 0 },
    },
    r: {
      id: "r",
      name: "r",
      parentId: null,
      visible: true,
      locked: false,
      type: "rectangle",
      transform: { x: 300, y: 300, width: 60, height: 60, rotation: 0 },
    },
  },
}

// The canvas document is workspace-backed: design-canvas-tab.tsx composes an SDK
// file store over the localStorage repository, which is only consulted when the
// workspace read rejects or the workspace file is absent
// (persistence/workspace-repository.ts:60-74), and the document id is the
// hardcoded "canvas", so it lives at .unifia/design/canvas.design.json - one per
// workspace. `directory` is scope:"worker" (e2e/fixtures.ts), so without this
// reset a previous spec or a previous run leaves a canvas document behind, the
// seed below is discarded, and the panel renders a document that has no node "r".
async function resetWorkspaceCanvas(directory: string) {
  await rm(join(directory, ".unifia", "design", "canvas.design.json"), { force: true })
}

// And the assertions must read the store the product actually writes: the
// workspace. The localStorage copy is only refreshed when a workspace write
// fails, so reading it back can never observe a real edit - that is why the
// visibility/lock/reorder assertions below could not pass even with a good seed.
function readNodeFromDisk(directory: string, id: string) {
  return fs
    .readFile(join(directory, ".unifia", "design", "canvas.design.json"), "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw) as {
        nodes?: Record<string, { visible?: boolean; locked?: boolean; parentId?: string | null }>
      }
      return parsed.nodes?.[id] ?? null
    })
    .catch(() => null)
}

function readChildrenFromDisk(directory: string, id: string) {
  return fs
    .readFile(join(directory, ".unifia", "design", "canvas.design.json"), "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw) as {
        nodes?: Record<string, { childIds?: string[] }>
      }
      return parsed.nodes?.[id]?.childIds ?? null
    })
    .catch(() => null)
}

test("layers panel drives visibility, lock, reorder and reparent on the canonical document", async ({
  page,
  directory,
  backend,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await resetWorkspaceCanvas(directory)
  await seedStorage(page, { directory, model: backend.model, serverUrl: backend.url })
  await page.addInitScript(
    ([key, seed]) => {
      window.localStorage.setItem(key, JSON.stringify(seed))
    },
    [STORAGE_KEY, SEED] as const,
  )
  await page.goto(`${dirPath(directory)}/design`)

  const t = track(page)
  // ADR-085: Design opens on the canvas studio, no tab to click.
  await expect(page.locator("[data-design-canvas]")).toHaveAttribute("data-design-canvas-status", "ready")
  await expect(page.locator("[data-design-layers]")).toBeVisible()

  // Visibility and lock are commands, not panel state.
  await page.locator('[data-design-layer-visibility="r"]').click()
  await expect.poll(async () => (await readNodeFromDisk(directory, "r"))?.visible, { message: "visibility must persist" }).toBe(
    false,
  )
  await page.locator('[data-design-layer-lock="a"]').click()
  await expect.poll(async () => (await readNodeFromDisk(directory, "a"))?.locked, { message: "lock must persist" }).toBe(true)

  // Reorder: dropping b on a moves b to a's canonical index (front-first rows,
  // back-to-front storage order).
  await page.locator('[data-design-layer-row="b"]').dragTo(page.locator('[data-design-layer-row="a"]'))
  await expect.poll(() => readChildrenFromDisk(directory, "f"), { message: "reorder must rewrite childIds" }).toEqual(["b", "a"])

  // Reparent: dropping the root rect on the frame appends it frontmost.
  await page.locator('[data-design-layer-row="r"]').dragTo(page.locator('[data-design-layer-row="f"]'))
  await expect.poll(async () => (await readNodeFromDisk(directory, "r"))?.parentId, { message: "reparent must persist" }).toBe("f")
  await expect.poll(() => readChildrenFromDisk(directory, "f"), { message: "the frame must own the dropped node" }).toEqual([
    "b",
    "a",
    "r",
  ])

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
