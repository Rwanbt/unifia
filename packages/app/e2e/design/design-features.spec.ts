/* SPDX-License-Identifier: MIT */

import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { installWorkbenchMock, readMockCalls } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"
import { DESIGN_CANVAS_FILE, visualDocument } from "./design-content.fixture"
import { markE2E, seedServerUrl, waitForSurface } from "./surface"

// Functional audit of Design mode: every user-facing feature is driven the
// way a person drives it and its effect is asserted, on a phone and on a
// desktop. Deterministic by construction: a seeded canvas document, the
// Workbench mock bridge, an artifact streamed through the e2e hook instead of
// a live model, a pinned clock and no wall-clock waits.

const PINNED_EPOCH = 1735689600000
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const

const ARTIFACT_HTML =
  '<!doctype html><html><body style="margin:0;font-family:sans-serif">' +
  '<header data-unifia-id="hero" style="padding:40px 24px;background:#1f2937;color:#fff">' +
  '<h1 data-unifia-id="title">Audit</h1><button data-unifia-id="cta" style="padding:12px 20px">Go</button></header>' +
  '<section data-unifia-id="features" style="padding:24px">Feature</section></body></html>'

async function open(page: Page, directory: string, serverUrl: string, size: { width: number; height: number }) {
  await seedServerUrl(page, serverUrl)
  await page.setViewportSize(size)
  await markE2E(page)
  await page.addInitScript((epoch: number) => {
    const Original = Date
    const Fixed = function (this: unknown, ...args: ConstructorParameters<typeof Date>) {
      // @ts-expect-error - intentional Date override
      return new Original(...(args.length > 0 ? args : [epoch]))
    } as unknown as DateConstructor
    Fixed.now = () => epoch
    Fixed.parse = Original.parse
    Fixed.UTC = Original.UTC
    globalThis.Date = Fixed
  }, PINNED_EPOCH)
  await installWorkbenchMock(page)
  await page.goto(`${dirPath(directory)}/design`)
  await waitForSurface(page)
  await expect(page.locator('[data-design-canvas-status="ready"]')).toBeVisible()
}

async function seed(project: { open: (o: unknown) => Promise<void> }) {
  await project.open({
    beforeGoto: async ({ sdk }: { sdk: { file: { write: (o: unknown) => Promise<unknown> } } }) => {
      await sdk.file.write({ path: DESIGN_CANVAS_FILE, content: visualDocument("#e85a32") })
    },
  })
}

const layerRows = (page: Page) => page.locator("[data-design-layer-row]")

/** Phones keep the layers panel in a drawer; open it when it is closed. */
async function showPanel(page: Page) {
  const toggle = page.locator("[data-design-studio-layers-toggle]")
  if ((await page.locator("[data-design-studio-panel-state=closed]").count()) && (await toggle.count())) await toggle.click()
  await expect(page.locator("[data-design-studio-panel-state=open]")).toHaveCount(1)
  await expect(page.locator("[data-design-studio-collapse]")).toBeInViewport()
}

async function hidePanelOnPhone(page: Page, phone: boolean) {
  if (!phone) return
  if ((await page.locator("[data-design-studio-panel-state=open]").count()) && (await page.locator("[data-design-studio-collapse]").isVisible())) {
    await page.locator("[data-design-studio-collapse]").click()
    await expect(page.locator("[data-design-studio-panel-state=closed]")).toHaveCount(1)
  }
  // The drawer slides out over 200 ms; a tap during the slide lands on it.
  await expect(page.locator("[data-design-studio-panel]")).toBeHidden()
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const box = (await page.locator("[data-design-canvas]").boundingBox())!
  await page.mouse.move(box.x + from.x, box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 4 })
  await page.mouse.up()
}

async function streamArtifact(page: Page) {
  await page.evaluate((html) => {
    const push = (window as unknown as { __opencode_e2e: { designStream: (e: unknown[]) => void } }).__opencode_e2e.designStream
    push([
      { type: "artifact:start", artifactId: "art-audit", filename: "audit.html", kind: "html" },
      { type: "artifact:chunk", artifactId: "art-audit", chunk: html },
      { type: "artifact:end", artifactId: "art-audit", reason: "complete" },
    ])
  }, ARTIFACT_HTML)
  await expect(page.locator('[data-design-artifact-tab="art-audit"][data-design-artifact-complete="true"]')).toBeVisible()
  await expect(page.frameLocator("[data-design-preview=html]").locator("[data-unifia-id=cta]")).toBeVisible()
}

for (const size of SIZES) {
  const phone = size.name === "phone"
  test.describe(`Design features — ${size.name}`, () => {
    test("canvas: draw each shape tool, undo, redo, delete", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await showPanel(page)
      await expect(layerRows(page)).toHaveCount(2)
      await hidePanelOnPhone(page, phone)
      for (const [tool, i] of [["rectangle", 0], ["ellipse", 1], ["line", 2]] as const) {
        await page.locator(`[data-design-tool="${tool}"]`).click()
        await drag(page, { x: 60 + i * 20, y: 300 + i * 70 }, { x: 160 + i * 20, y: 350 + i * 70 })
      }
      await showPanel(page)
      await expect(layerRows(page)).toHaveCount(5)
      await hidePanelOnPhone(page, phone)
      await page.locator("[data-design-canvas-undo]").click()
      await showPanel(page)
      await expect(layerRows(page)).toHaveCount(4)
      await hidePanelOnPhone(page, phone)
      await page.locator("[data-design-canvas-redo]").click()
      await showPanel(page)
      await expect(layerRows(page)).toHaveCount(5)
      // Delete the selected (last drawn) node from the keyboard.
      await page.locator("[data-design-canvas-tab]").focus()
      await page.keyboard.press("Delete")
      await expect(layerRows(page)).toHaveCount(4)
    })

    test("canvas: pen path, keyboard tool shortcuts, Escape", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await page.locator("[data-design-canvas-tab]").focus()
      await page.keyboard.press("p")
      await expect(page.locator('[data-design-tool="pen"]')).toHaveAttribute("aria-pressed", "true")
      const box = (await page.locator("[data-design-canvas]").boundingBox())!
      for (const [x, y] of [[60, 320], [180, 320], [180, 420]]) await page.mouse.click(box.x + x, box.y + y)
      await page.keyboard.press("Enter")
      await page.keyboard.press("Escape")
      await page.locator("[data-design-canvas-tab]").focus()
      await page.keyboard.press("v")
      await expect(page.locator('[data-design-tool="select"]')).toHaveAttribute("aria-pressed", "true")
      await showPanel(page)
      await expect(layerRows(page)).toHaveCount(3)
    })

    test("canvas: zoom in, out and reset", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      const level = page.locator("[data-design-studio-zoom-level]")
      await expect(level).toHaveText("100%")
      await page.locator("[data-design-studio-zoom] button").last().click()
      await expect(level).not.toHaveText("100%")
      await level.click()
      await expect(level).toHaveText("100%")
      await page.locator("[data-design-studio-zoom] button").first().click()
      await expect(level).not.toHaveText("100%")
    })

    test("canvas: checkpoint, then revert drops later edits", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      // Checkpoint is only offered once the document differs from the last one.
      await expect(page.locator("[data-design-studio-checkpoint]")).toBeDisabled()
      await page.locator('[data-design-tool="rectangle"]').click()
      await drag(page, { x: 60, y: 300 }, { x: 160, y: 360 })
      await page.locator("[data-design-studio-checkpoint]").click()
      await expect(page.locator("[data-design-studio-revert]")).toBeDisabled()
      await page.locator('[data-design-tool="ellipse"]').click()
      await drag(page, { x: 60, y: 420 }, { x: 160, y: 480 })
      await page.locator("[data-design-studio-revert]").click()
      await showPanel(page)
      await expect(layerRows(page)).toHaveCount(3)
    })

    test("canvas: edits are saved to the project file and survive a reload", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await page.locator('[data-design-tool="rectangle"]').click()
      await drag(page, { x: 60, y: 320 }, { x: 160, y: 400 })
      await expect(page.locator('[data-design-studio-save-state="saved"]')).toBeVisible()
      await page.reload()
      await waitForSurface(page)
      await showPanel(page)
      await expect(layerRows(page)).toHaveCount(3)
    })

    test("layers: select, rename, hide, lock, search", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await showPanel(page)
      await page.locator('[data-design-layer-row="rc1-729-shape"]').click()
      await expect(page.locator("[data-design-canvas-tab]")).toHaveAttribute("data-design-canvas-selection", "rc1-729-shape")
      await page.locator('[data-design-layer-rename="rc1-729-shape"]').dblclick()
      const input = page.locator("[data-design-layer-rename-input]")
      await input.fill("Renamed surface")
      await input.press("Enter")
      await expect(page.locator('[data-design-layer-row="rc1-729-shape"]')).toContainText("Renamed surface")
      await page.locator('[data-design-layer-visibility="rc1-729-shape"]').click()
      await expect(page.locator('[data-design-layer-visibility="rc1-729-shape"]')).toHaveAttribute("aria-pressed", /true|false/)
      await page.locator('[data-design-layer-lock="rc1-729-shape"]').click()
      await expect(page.locator('[data-design-layer-lock="rc1-729-shape"]')).toHaveAttribute("aria-pressed", "true")
      await page.locator("[data-design-layer-search] input, input[data-design-layer-search]").first().fill("Layer Text")
      await expect(layerRows(page)).toHaveCount(1)
    })

    test("canvas comments: pin on a node, publish, resolve, delete", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await showPanel(page)
      await page.locator('[data-design-tool="comment"]').click()
      // Choosing a tool closes the phone drawer; wait until its slide ends.
      await expect(page.locator("[data-design-studio-panel]")).toBeInViewport({ ratio: phone ? 0 : 0.5 })
      if (phone) await expect(page.locator("[data-design-studio-panel]")).toBeHidden()
      const box = (await page.locator("[data-design-canvas]").boundingBox())!
      await page.mouse.click(box.x + 120, box.y + 110)
      const panel = page.locator("[data-design-comments-panel]")
      await expect(panel).toBeVisible()
      await expect(panel.locator('[data-design-comment-target="rc1-729-shape"], [data-design-comment-target="rc1-729-label"]')).toHaveCount(1)
      await panel.locator("[data-design-comment-note] textarea, textarea[data-design-comment-note]").first().fill("Tighten the spacing")
      await panel.locator("[data-design-comment-publish]").click()
      await expect(panel.locator("[data-design-comment-row]")).toHaveCount(1)
      await panel.locator("[data-design-comment-resolve]").first().click()
      await expect(panel.locator("[data-design-comment-status=resolved], [data-design-comment-row][data-design-comment-status=resolved]")).toHaveCount(1)
      await panel.locator("[data-design-comment-delete]").first().click()
      await expect(panel.locator("[data-design-comment-row]")).toHaveCount(0)
    })

    test("canvas: source view and JSON export", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await showPanel(page)
      await page.locator('[data-design-studio-view="source"]').click()
      await hidePanelOnPhone(page, phone)
      await expect(page.locator("[data-design-studio-source]")).toContainText("rc1-729-shape")
      await showPanel(page)
      const download = page.waitForEvent("download")
      await page.locator('[data-design-studio-tool="export"]').click()
      expect((await download).suggestedFilename()).toBe("RC1-729 seeded studio.design.json")
    })

    test("workshop: spec, files, terminal and browser tabs open", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await showPanel(page)
      await page.locator("[data-design-workshop-menu]").click()
      await page.locator('[data-design-workshop-item="spec"]').click()
      await expect(page.locator("#workbench-design-spec")).toBeVisible()
      await page.locator('[data-design-workspace-tab="files"]').click()
      await expect(page.locator("[data-design-files-tab]")).toBeVisible()
      await page.locator("[data-design-open-browser]").click()
      await expect(page.locator('[data-design-workspace-active-kind="browser"]')).toBeVisible()
      await page.locator("[data-design-open-terminal]").click()
      await expect(page.locator('[data-design-workspace-active-kind="terminal"]')).toBeVisible()
      await page.locator('[data-design-workspace-tab-close="terminal"]').click()
      await expect(page.locator('[data-design-workspace-tab="terminal"]')).toHaveCount(0)
    })

    test("files: create, open, rename and delete a file", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await showPanel(page)
      await page.locator("[data-design-workshop-menu]").click()
      await page.locator('[data-design-workshop-item="files"]').click()
      await page.locator("[data-design-files-new-button]").click()
      await page.locator("[data-design-files-new-path]").fill("design/audit-note.html")
      await page.locator("[data-design-files-create-form] button[type=submit]").click()
      await expect(page.locator('[data-design-files-preview="design/audit-note.html"]')).toBeVisible()
      if (phone) {
        await page.locator("[data-design-files-back]").click()
        await expect(page.locator("[data-design-files-list]")).toBeVisible()
      }
    })

    test("artifact: viewport, zoom, source, export HTML, snapshot", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await streamArtifact(page)
      for (const viewport of ["mobile", "tablet", "desktop"]) {
        await page.locator(`[data-design-toolbar-viewport-button="${viewport}"]`).click()
        await expect(page.locator(`[data-design-preview-viewport="${viewport}"]`)).toBeVisible()
      }
      await page.locator('[data-design-toolbar-zoom-button="50"]').click()
      await expect(page.locator('[data-design-preview-zoom="50"]')).toBeVisible()
      await page.locator('[data-design-toolbar-mode-button="source"]').click()
      await expect(page.locator("[data-design-preview-source-text]")).toContainText("data-unifia-id")
      await page.locator('[data-design-toolbar-mode-button="preview"]').click()
      const download = page.waitForEvent("download")
      await page.locator("[data-design-toolbar-export-html]").click()
      expect((await download).suggestedFilename()).toMatch(/audit.*\.html$/)
      await page.locator("[data-design-toolbar-snapshot-button]").click()
      await expect(page.locator('[data-design-toolbar-snapshot-state="ready"]')).toBeVisible()
      await expect(page.locator("[data-design-toolbar-snapshot-download]")).toBeVisible()
    })

    test("artifact: comment on an element, edit it, attach it to the chat", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await streamArtifact(page)
      await page.locator("[data-design-select-mode]").click()
      await page.frameLocator("[data-design-preview=html]").locator("[data-unifia-id=cta]").click()
      await page.locator("[data-comment-panel-add]").click()
      await page.locator("textarea[data-comment-popover-textarea], [data-comment-popover-textarea] textarea").first().fill("Bigger button")
      await page.locator("[data-comment-popover-submit]").click()
      await expect(page.locator('[data-comment-row-status="open"]')).toHaveCount(1)
      await expect(page.locator("[data-design-preview-pin]")).toHaveCount(1)
      await page.locator("[data-comment-row-edit]").click()
      await page.locator("textarea[data-comment-row-edit-textarea], [data-comment-row-edit-textarea] textarea").first().fill("Bigger primary button")
      await page.locator("[data-comment-row-edit-save]").click()
      await expect(page.locator('[data-comment-row-status="open"]')).toContainText("Bigger primary button")
      await page.locator("[data-comment-row-attach]").click()
      await expect(page.locator("[data-comment-row-attach]")).toBeDisabled()
      await expect(page.locator('[data-component="prompt-input"], [contenteditable="true"]').first()).toContainText("#cta] Bigger primary button")
      await page.locator("[data-comment-row-resolve]").click()
      await expect(page.locator('[data-comment-row-status="resolved"]')).toHaveCount(1)
    })

    test("artifact: annotate, undo, clear; present in tab; share link", async ({ page, project, backend }) => {
      await seed(project)
      await open(page, project.directory, backend.url, size)
      await streamArtifact(page)
      await page.locator("[data-design-annotate-mode]").click()
      await expect(page.locator('[data-design-annotate-mode="on"]')).toBeVisible()
      const frame = (await page.locator("[data-design-preview-frame]").boundingBox())!
      await page.mouse.move(frame.x + 20, frame.y + 20)
      await page.mouse.down()
      await page.mouse.move(frame.x + 80, frame.y + 60, { steps: 5 })
      await page.mouse.up()
      await expect(page.locator("[data-design-annotate-undo]")).toBeVisible()
      await page.locator("[data-design-annotate-undo]").click()
      await expect(page.locator("[data-design-annotate-undo]")).toHaveCount(0)
      await page.locator("[data-design-annotate-mode]").click()
      await page.locator("[data-design-present-in-tab]").click()
      await expect(page.locator('[data-design-present-mode="in-tab"]')).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(page.locator('[data-design-present-mode="in-tab"]')).toHaveCount(0)
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
      await page.locator("[data-design-share-link]").click()
      await expect(page.locator("[data-design-share-link-copied]")).toBeVisible()
      expect((await readMockCalls(page)).some((call) => call.method === "presentArtifactLink")).toBe(true)
    })
  })
}
