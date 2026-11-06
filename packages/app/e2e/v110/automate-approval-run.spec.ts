/* SPDX-License-Identifier: MIT */

import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { startWorkbenchRuntimeTransport, type WorkbenchRuntimeTransport } from "../fixtures/workbench-runtime"
import { goto } from "./gate"

// An approval node used to leave the run "running" for ever: the engine waits
// for an external event and nothing in the product delivered it. These runs go
// through the real Workbench runtime, from Run to the run's terminal state.
const DEFINITION_PATH = ".unifia/workflows/gated.json"
const DEFINITION = {
  id: "gated",
  version: 1,
  steps: [
    { id: "gate", family: "human.approval" },
    { id: "after", family: "tool.transform", config: { fields: { done: "true" } } },
  ],
}

async function openStudio(page: Page, gotoSession: () => Promise<void>, transport: WorkbenchRuntimeTransport): Promise<void> {
  await installWorkbenchMock(page, {
    workspaceId: transport.workspaceId,
    grants: ["workflow.run"],
    files: [{ path: DEFINITION_PATH, kind: "file" }],
    fileContents: { [DEFINITION_PATH]: JSON.stringify(DEFINITION) },
    workflowTransport: { baseUrl: transport.baseUrl, workspaceId: transport.workspaceId, token: transport.token },
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoSession()
  await goto(page, "automate")
  await expect(page.locator('[data-automate-studio-node="gate"]')).toBeVisible()
}

const bar = (page: Page) => page.locator("[data-automate-studio-run-bar]")

test("an approval node waits for the person, and Approve runs the workflow to the end", async ({ page, gotoSession }) => {
  const transport = await startWorkbenchRuntimeTransport()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await openStudio(page, gotoSession, transport)
    await page.locator('[data-automate-studio-run-bar-action="start"]').click()
    await expect(bar(page)).toHaveAttribute("data-automate-studio-run-bar-state", "waiting-step")
    await expect(page.locator('[data-automate-studio-run-bar-action="reject"]')).toBeVisible()

    const completed = page.waitForResponse((response) => response.url().endsWith("/complete") && response.request().method() === "POST")
    await page.locator('[data-automate-studio-run-bar-action="approve"]').click()
    expect((await completed).status()).toBe(200)
    await expect(bar(page)).toHaveAttribute("data-automate-studio-run-bar-state", "idle")
    await expect(page.locator('[data-automate-studio-run-bar-action="approve"]')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await transport.stop()
  }
})

test("Reject cancels the waiting run instead of completing it", async ({ page, gotoSession }) => {
  const transport = await startWorkbenchRuntimeTransport()
  try {
    await openStudio(page, gotoSession, transport)
    await page.locator('[data-automate-studio-run-bar-action="start"]').click()
    await expect(bar(page)).toHaveAttribute("data-automate-studio-run-bar-state", "waiting-step")
    await page.locator('[data-automate-studio-run-bar-action="reject"]').click()
    await expect(bar(page)).toHaveAttribute("data-automate-studio-run-bar-state", "cancelled")
  } finally {
    await transport.stop()
  }
})
