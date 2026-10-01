/* SPDX-License-Identifier: MIT */
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { createSdk } from "../utils"

test("Work update uses real Team facts, survives reload and exposes request failures", async ({
  page,
  sdk,
  llm,
  gotoSession,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await installWorkbenchMock(page, { workspaceId: "mock-workspace-1" })
  await gotoSession()
  const enter = async () => {
    const work = page.getByRole("button", { name: "work mode" })
    if ((await work.getAttribute("aria-pressed")) !== "true") await work.click()
    await page.getByRole("radio", { name: "Editor" }).click()
  }
  await enter()
  const generate = page.locator("[data-work-generate-update]")
  await expect(generate).toBeDisabled()
  const { runID, release } = await startHeldRun(sdk, llm)
  try {
    await expect.poll(async () => (await sdk.team.listTasks({ runID })).data?.items[0]?.status).toBe("running")
    await page.reload()
    await enter()
    await expect(generate).toBeEnabled()
    const posted = page.waitForResponse(
      (response) => response.url().includes(`/team/runs/${runID}/updates`) && response.request().method() === "POST",
    )
    await generate.click()
    const response = await posted
    expect(response.status()).toBe(200)
    const result = await response.json()
    expect(result.update.tasks).toMatchObject({ total: 1, running: 1, completed: 0 })
    expect(result.update.reviews).toEqual({ total: 0, changesRequested: 0 })
    const summary = page.locator(`[data-work-update-event="${result.eventId}"]`)
    await expect(summary).toContainText("0/1")
    await page.reload()
    await enter()
    await expect(summary).toBeVisible()
    const latest = await sdk.team.latestProjectUpdate({ runID })
    expect(latest.data).toEqual(result)
    const events = await sdk.team.listEvents({ runID, cursor: String(result.sequence - 1) })
    expect(events.data?.items.find((event) => event.eventId === result.eventId)?.payload).toEqual(result.update)
    await page.screenshot({ path: info.outputPath("project-update.png") })

    const failedRoute = (url: URL) => url.pathname === `/team/runs/${runID}/updates`
    await page.route(failedRoute, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }),
    )
    const rejected = page.waitForResponse(
      (response) => failedRoute(new URL(response.url())) && response.status() === 503,
    )
    await generate.click()
    expect((await rejected).status()).toBe(503)
    await expect(page.locator("[data-work-project-update] [role=alert]")).toBeVisible()
    await expect(summary).toBeVisible()
    expect((await sdk.team.latestProjectUpdate({ runID })).data?.eventId).toBe(result.eventId)
    await page.unroute(failedRoute)
    await generate.click()
    await expect(page.locator("[data-work-project-update] [role=alert]")).toHaveCount(0)
    await expect
      .poll(async () => (await sdk.team.latestProjectUpdate({ runID })).data?.sequence)
      .toBeGreaterThan(result.sequence)
  } finally {
    await sdk.team.cancelRun({ runID })
    release()
    if ((await llm.pending()) > 0) await llm.reset()
  }
})

async function startHeldRun(
  sdk: ReturnType<typeof createSdk>,
  llm: { hold: (value: string, wait: PromiseLike<unknown>) => Promise<void> },
) {
  const selection = await sdk.team.config({
    models: [
      { providerID: "e2e", modelID: "test-model" },
      { providerID: "e2e", modelID: "review-model" },
    ],
  })
  expect(selection.error).toBeUndefined()
  let release = () => {}
  await llm.hold(
    "ok",
    new Promise<void>((resolve) => {
      release = resolve
    }),
  )
  const started = await sdk.team.startRun({
    description: "Project update persistence",
    tasks: [
      {
        id: "update-task",
        description: "Observe project facts",
        prompt: "Wait while facts are observed.",
        agent: "build",
        mode: "read",
        required: true,
        risk: "low",
        dependsOn: [],
        readSet: [],
        writeSet: [],
        modelIndex: 0,
      },
    ],
  })
  const runID = started.data?.runId
  if (!runID) throw new Error("Team did not return a run id")
  return { runID, release }
}
