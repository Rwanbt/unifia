/* SPDX-License-Identifier: MIT */

// Lot D journey: the Team lifecycle controls from the surface a user actually
// presses. The Runs panel deliberately leaves pause/resume/cancel to
// TeamPanel ("Open Team"); the route tier covers the HTTP contract, and this
// spec covers the UI contract against the isolated backend's real
// HTTP/SQLite path:
//
//   seed a run through the API and pause it immediately - paused while it is
//   still pending, which is the stable product state (a paused run makes no
//   progress, so no click below can race the worker; measured stable for
//   seconds in the harness). Re-enter the Work surface so the Team provider
//   mounts fresh and reads the paused run from the server (which also proves
//   the paused state survives a UI reload), then drive the panel: the row
//   offers Resume and Cancel, the first Cancel click only ARMS the
//   confirmation (no request, no effect), the confirmed cancel is a 200 whose
//   reply carries controlStatus "cancelled" and whose run becomes durably
//   "aborted" (an aborted signal races the worker: application-service.ts),
//   every lifecycle control disappears, and a resume is refused ("it cannot
//   be resumed afterward", routes/team.ts).
//   The Resume button itself is driven in the second test, where its own
//   response body carries the new controlStatus - asserted from the reply,
//   not polled.
//
// The start goes through the SDK rather than the start-run form because the
// lifecycle subject is the controls; state-seeding through the SDK is this
// suite's established practice (the content-gate spec seeds its canvas the
// same way). The form-started run was measured to leave the registry before
// a first control could reach it in this harness - a separate finding, not
// something this spec should hide behind a retry.

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

const soon = /^(Pause|Resume|Cancel|Confirm cancel)$/

// The cancel route refuses any control of a run that is no longer active in
// this process with this exact 409 body (routes/team.ts), which the generated
// client throws. The worker releases a cancelled run (run-registry.finish) the
// moment the abort lands, so this refusal is a terminal state, not a failure.
const inactive = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "error" in value &&
  typeof (value as { error: unknown }).error === "string" &&
  (value as { error: string }).error.includes("is not active in this process")

test("a paused run: arming the cancel is not acting, the confirmed cancel sticks, and resumption is refused", async ({ page, directory, sdk, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await installWorkbenchMock(page)
  const selection = await sdk.team.config({
    models: [
      { providerID: "e2e", modelID: "test-model" },
      { providerID: "e2e", modelID: "review-model" },
    ],
  })
  expect(selection.error).toBeUndefined()
  await gotoSession()

  const started = await sdk.team.startRun({
    description: "Lifecycle journey",
    tasks: [
      {
        id: "t1",
        description: "Wait for the lifecycle controls",
        prompt: "Wait for the lifecycle controls, then keep waiting.",
        agent: "build",
        mode: "write",
      },
    ],
  })
  expect(started.error).toBeUndefined()
  if (!started.data) throw new Error("startRun returned no runId")
  const runId = started.data.runId
  try {
    const paused = await sdk.team.pauseRun({ runID: runId })
    expect(paused.error).toBeUndefined()
    expect(paused.data?.controlStatus).toBe("paused")

    const run = async () => (await sdk.team.listRuns({ limit: 50 })).data?.items.find((item) => item.runId === runId)
    const status = async () => (await run())?.controlStatus
    const durable = async () => (await run())?.status
    // Fresh mount: the provider reads the paused run from the server.
    await openRuns(page, directory)
    await page.locator('[data-v110="work-open-team"]').click()
    const row = page.getByRole("button", { name: runId, exact: true }).locator("..")
    await expect(row).toBeVisible()
    // The paused run renders its resume path, not its pause path.
    await expect(row.getByRole("button", { name: "Resume", exact: true })).toBeVisible()

    // Arming is not acting: the first Cancel click only relabels the button.
    await row.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(row.getByRole("button", { name: "Confirm cancel", exact: true })).toBeVisible()
    expect(await status()).toBe("paused")

    // Confirming cancels, the controls disappear, and a resume is refused.
    const cancelled = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/team/runs/${runId}/cancel` && response.request().method() === "POST",
    )
    await row.getByRole("button", { name: "Confirm cancel", exact: true }).click()
    const confirmation = await cancelled
    expect(confirmation.status()).toBe(200)
    // The reply itself carries the control-level state (as on the resume path):
    // polling controlStatus afterwards would race the worker, which releases
    // the run (run-registry.finish) the moment the abort lands.
    expect((await confirmation.json()) as { controlStatus?: string }).toMatchObject({ controlStatus: "cancelled" })
    // The durable outcome is the run's own status: cancel aborts the run.
    await expect.poll(durable).toBe("aborted")
    await expect(row.getByRole("button", { name: soon })).toHaveCount(0)
    // The generated client throws the parsed refusal for this call rather
    // than returning it; both shapes are refused states, and none of them
    // may be a success.
    let refused: unknown
    try {
      await sdk.team.resumeRun({ runID: runId })
    } catch (error) {
      refused = error
    }
    expect(refused, "resume after cancel must be refused").toBeTruthy()
  } finally {
    // Cleanup is hygiene, not an assertion: the journey above already asserted
    // the lifecycle outcome. The worker may have released the run before this
    // runs, and the cancel route then refuses with its documented 409
    // "not active" (routes/team.ts) - the terminal state this test proved.
    // Any other failure still surfaces.
    const refusal = await sdk.team.cancelRun({ runID: runId }).then(
      () => undefined,
      (error: unknown) => error,
    )
    if (refusal !== undefined && !inactive(refusal)) throw refusal
  }
})

test("the Resume button drives the resume control from the panel", async ({ page, directory, sdk, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await installWorkbenchMock(page)
  const selection = await sdk.team.config({
    models: [
      { providerID: "e2e", modelID: "test-model" },
      { providerID: "e2e", modelID: "review-model" },
    ],
  })
  expect(selection.error).toBeUndefined()
  await gotoSession()

  const started = await sdk.team.startRun({
    description: "Lifecycle journey (resume)",
    tasks: [
      {
        id: "t1",
        description: "Wait for the lifecycle controls",
        prompt: "Wait for the lifecycle controls, then keep waiting.",
        agent: "build",
        mode: "write",
      },
    ],
  })
  expect(started.error).toBeUndefined()
  if (!started.data) throw new Error("startRun returned no runId")
  const runId = started.data.runId
  try {
    const paused = await sdk.team.pauseRun({ runID: runId })
    expect(paused.error).toBeUndefined()
    expect(paused.data?.controlStatus).toBe("paused")

    await openRuns(page, directory)
    await page.locator('[data-v110="work-open-team"]').click()
    const row = page.getByRole("button", { name: runId, exact: true }).locator("..")
    await expect(row).toBeVisible()
    const resumed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/team/runs/${runId}/resume` && response.request().method() === "POST",
    )
    await row.getByRole("button", { name: "Resume", exact: true }).click()
    const response = await resumed
    expect(response.status()).toBe(200)
    // The reply itself carries the new state; no polling can race the worker.
    expect((await response.json()) as { controlStatus?: string }).toMatchObject({ controlStatus: "running" })
  } finally {
    // Cleanup is hygiene, not an assertion: the journey above already asserted
    // the lifecycle outcome. The worker may have released the run before this
    // runs, and the cancel route then refuses with its documented 409
    // "not active" (routes/team.ts) - the terminal state this test proved.
    // Any other failure still surfaces.
    const refusal = await sdk.team.cancelRun({ runID: runId }).then(
      () => undefined,
      (error: unknown) => error,
    )
    if (refusal !== undefined && !inactive(refusal)) throw refusal
  }
})
