/* SPDX-License-Identifier: MIT */
import type { Locator, Page, Request } from "@playwright/test"
import { test, expect } from "../fixtures"
import { installWorkbenchMock, readMockCalls } from "../fixtures/workbench-mock"
import { openDesignSurface } from "../design/surface"
import { goto } from "./gate"
import { dirPath } from "../utils"

test.use({ backendIsolation: "rc1-deferred-controls" })

const MUTATIONS = new Set([
  "createArtifact", "exportArtifact", "resolveApproval", "cancelApproval",
  "renameFile", "createFiles", "removeFiles", "startWorkflow", "runWorkflow",
])

async function assertInert(
  page: Page,
  controls: Locator,
  readState: () => Promise<unknown>,
): Promise<void> {
  const buttons = await controls.all()
  expect(buttons.length, "the deferred control selector must match real buttons").toBeGreaterThan(0)
  const initialUrl = page.url()
  const initialState = await readState()
  const callsBefore = (await readMockCalls(page)).filter((call) => MUTATIONS.has(call.method))

  // A negative control proves the HTTP watcher is actually connected.
  // Fulfill the probe inside Playwright so this never writes to a server.
  const writes: string[] = []
  const listener = (request: Request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url())
  }
  page.on("request", listener)
  await page.route("**/__deferred_control_probe", (route) => route.fulfill({ status: 204 }))
  await page.evaluate(() => fetch("/__deferred_control_probe", { method: "POST" }))
  expect(writes.some((url) => url.includes("__deferred_control_probe"))).toBe(true)
  writes.length = 0

  try {
    for (const button of buttons) {
      await expect(button).toBeVisible()
      await expect(button).toHaveAttribute("aria-disabled", "true")
      await expect(button).toHaveJSProperty("disabled", false)
      await expect(button).toHaveJSProperty("tabIndex", 0)
      const accessibleName = await button.getAttribute("aria-label") ?? await button.innerText()
      expect(accessibleName.trim()).not.toBe("")
      await expect(button).not.toHaveAttribute("title", /coming soon|bientôt/i)
      // WHY forced: Playwright's actionability treats aria-disabled as disabled
      // and would wait forever; the contract is that even a delivered click
      // produces no effect.
      await button.click({ force: true })
      await button.focus()
      await expect(button).toBeFocused()
      await page.keyboard.press("Enter")
      await page.keyboard.press("Space")
      await button.evaluate((element) => element.click())
      await button.dispatchEvent("click")
    }
    expect(page.url()).toBe(initialUrl)
    expect(await readState()).toEqual(initialState)
    expect((await readMockCalls(page)).filter((call) => MUTATIONS.has(call.method))).toEqual(callsBefore)
    expect(writes, "deferred controls issued write HTTP requests").toEqual([])
  } finally {
    page.off("request", listener)
    // WHY guarded: a test that times out runs this while the page is already
    // closed; an unguarded unroute would then mask the real failure.
    if (!page.isClosed()) await page.unroute("**/__deferred_control_probe")
  }
}

test("Design deferred tools remain keyboard-focusable but cannot mutate the document", async ({ page, directory }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openDesignSurface(page, directory)
  await expect(page.locator("[data-design-studio-dock]")).toBeVisible()
  const controls = page.locator(
    '[data-design-studio-pending], [data-design-studio-tool][aria-disabled="true"], [data-design-studio-pages] button[aria-disabled="true"]',
  )
  await assertInert(page, controls, async () => ({
    pages: await page.locator("[data-design-studio-page]").count(),
    pressed: await page.locator('[data-design-studio-dock] button[aria-pressed="true"]').count(),
  }))
})

test("Automate deferred library and run-bar controls perform no command or backend write", async ({ page, directory, gotoSession }) => {
  const definitionPath = ".unifia/workflows/e2e-deferred.json"
  await installWorkbenchMock(page, {
    workspaceId: "mock-workspace-1",
    grants: ["workflow.run"],
    files: [{ path: definitionPath, kind: "file" }],
    fileContents: {
      [definitionPath]: JSON.stringify({
        id: "e2e-deferred",
        version: 1,
        steps: [{ id: "fetch", family: "io.http" }],
      }),
    },
  })
  await gotoSession()
  await page.setViewportSize({ width: 1440, height: 900 })
  await goto(page, "automate")
  await expect(page.locator('[data-workbench-surface="automate"]')).toBeVisible()
  await expect(page.locator('[data-automate-studio-node="fetch"]')).toBeVisible()
  const controls = page.locator(
    '[data-automate-studio-library-entry][data-soon], [data-automate-studio-run-bar] button[aria-disabled="true"]',
  )
  await assertInert(page, controls, async () => page.locator("[data-automate-studio-node]").count())
  await expect(page.locator('[data-automate-studio-library-entry="control.if"]')).toBeEnabled()
})

test("Work deferred controls refuse every activation path without changing the project", async ({ page, directory, gotoSession }) => {
  await installWorkbenchMock(page, { workspaceId: "mock-workspace-1" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoSession()
  await page.goto(`${dirPath(directory)}/work`)
  await page.getByRole("radio", { name: "Editor" }).click()
  await expect(page.locator('[data-workbench-surface="work"]')).toBeVisible()
  await assertInert(
    page,
    page.locator('[data-workbench-surface="work"] button[aria-disabled="true"]'),
    async () => page.locator('[data-workbench-surface="work"] [data-work-task]').count(),
  )
})
