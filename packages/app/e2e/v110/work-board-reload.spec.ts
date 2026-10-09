/* SPDX-License-Identifier: MIT */

import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { createSdk } from "../utils"

type TestSdk = ReturnType<typeof createSdk>
type LlmControl = {
  hold: (value: string, wait: PromiseLike<unknown>) => Promise<void>
  calls: () => Promise<number>
  pending: () => Promise<number>
  reset: () => Promise<void>
}

test("a human-moved Team task stays in its Kanban column after reload", async ({ page, sdk, llm, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  const selection = await sdk.team.config({
    models: [
      { providerID: "e2e", modelID: "test-model" },
      { providerID: "e2e", modelID: "review-model" },
    ],
  })
  expect(selection.error).toBeUndefined()

  const heldRun = await startHeldRun(sdk, llm, page)
  try {
    await expectTaskRunning(sdk, llm, heldRun.runId)
    await gotoSession()
    await enterWorkMode(page)
    await pinWorkNavigation(page)
    await moveTaskToBlocked(page)
    await page.reload()
    await enterWorkMode(page)
    await pinWorkNavigation(page)
    await page.locator('[data-work-view="board"]:visible').click()
    await expectBlockedTask(page)

    const persisted = await sdk.team.listTasks({ runID: heldRun.runId })
    expect(persisted.data?.items[0]?.status).toBe("blocked")
  } finally {
    // Release and reset first, and never let the cancel throw: a run that already
    // ended answers 409, and a throwing finally replaced the test's real failure
    // with that 409 and skipped the LLM reset (the "queued response" teardown error).
    heldRun.release()
    if ((await llm.pending()) > 0) await llm.reset()
    await sdk.team.cancelRun({ runID: heldRun.runId }).catch((error) => console.warn("cancelRun:", error))
  }
})

async function startHeldRun(sdk: TestSdk, llm: LlmControl, page: import("@playwright/test").Page) {
  let release: () => void = () => undefined
  const responseHeld = new Promise<void>((resolve) => { release = resolve })
  await llm.hold("ok", responseHeld)
  await installWorkbenchMock(page, { workspaceId: "mock-workspace-1" })
  const started = await sdk.team.startRun({
    description: "Kanban reload persistence",
    tasks: [{
      id: "persist-task",
      description: "Persist task status",
      prompt: "Keep this task blocked while the run is active.",
      agent: "build",
      mode: "read",
      required: true,
      risk: "low",
      dependsOn: [],
      readSet: [],
      writeSet: [],
      modelIndex: 0,
    }],
  })
  if (!started.data?.runId) throw new Error("Team did not return a run id")
  return { runId: started.data.runId, release }
}

async function expectTaskRunning(sdk: TestSdk, llm: LlmControl, runId: string) {
  await expect
    .poll(() => llm.calls())
    .toBeGreaterThan(0)
    .catch(async (error) => {
      throw new Error(`the Team task never reached the model; ${await describeWorkerFailure(sdk, runId)}`, {
        cause: error,
      })
    })
  await expect.poll(async () => {
    const result = await sdk.team.listTasks({ runID: runId })
    return result.data?.items[0]?.status
  }).toBe("running")
}

// A worker prompt that fails before calling the model records the error on
// its assistant message and goes idle; nothing reaches the server log, so the
// spec reads it back to make the failure say why.
async function describeWorkerFailure(sdk: TestSdk, runId: string) {
  const run = await sdk.team.getRun({ runID: runId }).then((r) => r.data, (e) => String(e))
  const sessions = await sdk.session.list().then((r) => r.data ?? [], () => [])
  const workers = sessions.filter((s) => s.title.includes("team member"))
  const errors = await Promise.all(
    workers.map(async (s) => {
      const messages = await sdk.session.messages({ sessionID: s.id }).then((r) => r.data ?? [], () => [])
      return messages.map((m) => (m.info as { error?: unknown }).error).filter(Boolean)
    }),
  )
  return `run: ${JSON.stringify(run)}; worker errors: ${JSON.stringify(errors.flat())}`
}

async function moveTaskToBlocked(page: import("@playwright/test").Page) {
  await page.locator('[data-work-view="board"]:visible').click()
  const taskCard = page.locator('[data-v110="work-board-card"][data-task-id="persist-task"]')
  await expect(taskCard).toBeVisible()
  await taskCard.locator('[data-v110="work-board-move"]').selectOption("blocked")
  await expectBlockedTask(page)
}

async function expectBlockedTask(page: import("@playwright/test").Page) {
  await expect(page.locator('[data-v110="work-board-column"][data-status="blocked"]')
    .locator('[data-v110="work-board-card"][data-task-id="persist-task"]')).toBeVisible()
}

async function enterWorkMode(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: "work mode" })
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click()
}

async function pinWorkNavigation(page: import("@playwright/test").Page) {
  await page.getByRole("radio", { name: "Editor" }).click()
  const sidebarToggle = page.getByRole("button", { name: /toggle sidebar|basculer la barre latérale/i })
  if ((await sidebarToggle.getAttribute("aria-expanded")) !== "true") await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true")
}
