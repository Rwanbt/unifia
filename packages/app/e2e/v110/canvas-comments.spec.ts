/* SPDX-License-Identifier: MIT */

// ADR-039 section 31 / #114 — canvas comments: the comment tool sets a node
// or zone target, publishing commits exactly one `addComment`, and the panel
// drives resolve/reopen and delete through the canonical commands (undo/redo
// round-trips each step). Pins live in the Konva overlay, so behaviour is
// asserted on the stored document and the panel DOM.

import { test, expect, seedStorage } from "../fixtures"
import { dirPath } from "../utils"
import { track } from "./gate"

const DOCUMENT_KEY = "unifia-design-document:v1:canvas"

const SEED = {
  schemaVersion: 2,
  id: "canvas",
  name: "Canvas",
  rootIds: ["a"],
  nodes: {
    a: {
      id: "a",
      name: "a",
      parentId: null,
      visible: true,
      locked: false,
      type: "rectangle",
      transform: { x: 200, y: 200, width: 100, height: 60, rotation: 0 },
    },
  },
}

type StoredComment = { id: string; nodeId: string | null; x: number; y: number; note: string; status: string }

function readComments(page: import("@playwright/test").Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { comments?: StoredComment[] }
    return parsed.comments ?? []
  }, DOCUMENT_KEY)
}

test("comment tool, pins and panel drive the canonical comment commands", async ({ page, directory, backend }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedStorage(page, { directory, model: backend.model, serverUrl: backend.url })
  await page.addInitScript(
    ([key, seed]) => {
      window.localStorage.setItem(key, JSON.stringify(seed))
    },
    [DOCUMENT_KEY, SEED] as const,
  )
  await page.goto(`${dirPath(directory)}/design`)

  const t = track(page)
  await page.locator("[data-design-open-canvas]").click()
  await expect(page.locator("[data-design-canvas]")).toHaveAttribute("data-design-canvas-status", "ready")

  // The comment tool opens the panel; the canvas narrows, so measure after.
  await page.locator('[data-design-tool="comment"]').click()
  const panel = page.locator("[data-design-comments-panel]")
  await expect(panel).toBeVisible()
  const target = page.locator("[data-design-comment-target]")
  const publish = page.locator("[data-design-comment-publish]")
  const note = page.locator("[data-design-comment-note]")
  await expect(target).toHaveAttribute("data-design-comment-target", "")
  await expect(publish).toBeDisabled()

  const surface = page.locator("[data-design-canvas] canvas").first()
  await expect.poll(async () => (await surface.boundingBox())?.width ?? 0, { message: "canvas must be laid out" })
    .toBeGreaterThan(400)
  const box = await surface.boundingBox()
  if (!box) return
  const at = (x: number, y: number) => ({ x: box.x + x, y: box.y + y })

  // A node comment: click the rect, type, publish — one addComment.
  await page.mouse.click(at(250, 230).x, at(250, 230).y)
  await expect(target).toHaveAttribute("data-design-comment-target", "a")
  await note.fill("Élargir le bouton")
  await expect(publish).toBeEnabled()
  await publish.click()
  await expect
    .poll(() => readComments(page), { message: "publishing must commit one addComment" })
    .toEqual([expect.objectContaining({ nodeId: "a", x: 250, y: 230, note: "Élargir le bouton", status: "open" })])
  const anchored = (await readComments(page))?.[0]
  if (!anchored) return
  await expect(page.locator("[data-design-comment-row]")).toHaveCount(1)
  await expect(target).toHaveAttribute("data-design-comment-target", "")
  await expect(publish).toBeDisabled()

  // A zone comment at the click position (no node under the pointer).
  await page.mouse.click(at(450, 450).x, at(450, 450).y)
  await expect(target).toHaveAttribute("data-design-comment-target", "zone")
  await note.fill("Zone à revoir")
  await publish.click()
  await expect
    .poll(() => readComments(page), { message: "the zone comment must store its click position" })
    .toHaveLength(2)
  const zone = (await readComments(page))?.[1]
  if (!zone) return
  expect(zone).toMatchObject({ nodeId: null, x: 450, y: 450, status: "open" })

  // Resolve → one undo reopens → redo resolves again.
  const anchoredRow = page.locator(`[data-design-comment-row="${anchored.id}"]`)
  await anchoredRow.locator("[data-design-comment-resolve]").click()
  await expect
    .poll(async () => (await readComments(page))?.find((comment) => comment.id === anchored.id)?.status)
    .toBe("resolved")
  await page.keyboard.press("Control+z")
  await expect
    .poll(async () => (await readComments(page))?.find((comment) => comment.id === anchored.id)?.status, {
      message: "undo must reopen the comment",
    })
    .toBe("open")
  await page.keyboard.press("Control+y")
  await expect
    .poll(async () => (await readComments(page))?.find((comment) => comment.id === anchored.id)?.status)
    .toBe("resolved")

  // Clicking a row selects its anchored node (v51 card behaviour).
  await anchoredRow.click()
  await expect(page.locator("[data-design-canvas-tab]")).toHaveAttribute("data-design-canvas-selection", "a")

  // Delete the zone comment and undo it back (the panel keeps focus after
  // its row re-renders, so the tab keeps receiving the shortcut).
  await page.locator(`[data-design-comment-row="${zone.id}"]`).locator("[data-design-comment-delete]").click()
  await expect.poll(() => readComments(page), { message: "delete must drop the zone comment" }).toHaveLength(1)
  await page.keyboard.press("Control+z")
  await expect.poll(() => readComments(page), { message: "undo must restore the deleted comment" }).toHaveLength(2)

  t.stop()
  expect(t.pages, "pageerrors: " + t.pages.join(" | ")).toEqual([])
  expect(t.logs, "console errors: " + t.logs.join(" | ")).toEqual([])
})
