/* SPDX-License-Identifier: MIT */

// A5-06: the "start a new run" form — the first real write path this
// workstream adds (sdk.client.team.startRun). createTestProject() already
// runs `git init` + a commit before every test (see e2e/actions.ts), which
// satisfies startRun's git-HEAD precondition, so a real submission can be
// asserted end-to-end. Deliberately does NOT try to drive the run to
// completion (would require mocking arbitrary per-task LLM calls for a
// user-authored task list) — only that the real 202-accepted path works and
// the new run becomes visible in the Runs tab.
//
// The Workbench availability boundary is mocked; Team submission, task rows
// and the Runs collection use the isolated backend's real HTTP/SQLite path.

import { test, expect } from "../fixtures"
import type { Page } from "@playwright/test"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { dirPath } from "../utils"

async function openRuns(page: Page, directory: string) {
  await page.goto(`${dirPath(directory)}/session`)
  await page.getByRole("button", { name: "work mode" }).click()
  await page.getByRole("radio", { name: "Editor" }).click()
  // Closed context-panel controls remain mounted behind the central workspace.
  const sidebarToggle = page.getByRole("button", { name: /toggle sidebar|basculer la barre latérale/i })
  if ((await sidebarToggle.getAttribute("aria-expanded")) !== "true") {
    await page.keyboard.press("ControlOrMeta+b")
  }
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true")
  const runs = page.locator('[data-work-view="runs"]:visible')
  await expect(runs).toHaveCount(1)
  await runs.click()
}

async function fillTask(page: Page) {
  const row = page.locator('[data-v110="work-start-run-task-row"]').first()
  await row.locator("input").first().fill("t1")
  await row.getByPlaceholder("Description").fill("Do the thing")
  await row.locator("textarea").fill("Do the thing, carefully.")
  const triggers = row.locator('[data-slot="select-select-trigger"]')
  await expect(triggers).toHaveCount(4)
  for (const trigger of await triggers.all()) {
    await trigger.press("Enter")
    await expect(page.getByRole("listbox")).toBeVisible()
    await expect.poll(() => page.getByRole("option").count()).toBeGreaterThan(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Start a new run" })).toBeVisible()
    await expect(trigger).toBeFocused()
  }
  await row.locator('[data-v110="work-start-run-agent"] [data-slot="select-select-trigger"]').click()
  await page.getByRole("option", { name: "build", exact: true }).click()
}

test("start-run form submits a real run and it appears in the Runs tab", async ({ page, directory, sdk, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await installWorkbenchMock(page)
  // Team execution is intentionally fail-closed unless two distinct models
  // are configured. The isolated E2E provider exposes both; seed the same
  // server-owned selection the settings surface would persist.
  const selection = await sdk.team.config({
    models: [
      { providerID: "e2e", modelID: "test-model" },
      { providerID: "e2e", modelID: "review-model" },
    ],
  })
  expect(selection.error).toBeUndefined()
  await gotoSession()
  await openRuns(page, directory)

  // Client-side validation rejects an empty form before any network call.
  await page.locator('[data-v110="work-start-run"]').click()
  await expect(page.locator('[data-v110="work-start-run-dialog"]')).toBeVisible()
  await expect(page.locator('[data-v110="work-start-run-submit"]')).toBeDisabled()

  await page.locator('[data-v110="work-start-run-description"]').fill("Automated test run")
  await fillTask(page)

  await expect(page.locator('[data-v110="work-start-run-submit"]')).toBeEnabled()
  const accepted = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/team/runs" && response.request().method() === "POST",
  )
  await page.locator('[data-v110="work-start-run-submit"]').click()
  const response = await accepted
  expect(response.status()).toBe(202)
  const result = await response.json()
  expect(typeof result.runId).toBe("string")
  try {
    await expect(page.locator('[data-v110="work-start-run-dialog"]')).not.toBeVisible()
    await expect(page.locator('[data-v110="work-runs-panel"]').getByText(result.runId, { exact: true })).toBeVisible()
    // HTTP 202 persists the run before the asynchronous runner persists its tasks.
    await expect.poll(async () => {
      const persisted = await sdk.team.listTasks({ runID: result.runId })
      return { error: persisted.error, taskIds: persisted.data?.items.map((task) => task.taskId) }
    }).toEqual({ error: undefined, taskIds: ["t1"] })
  } finally {
    await sdk.team.cancelRun({ runID: result.runId })
  }
})
