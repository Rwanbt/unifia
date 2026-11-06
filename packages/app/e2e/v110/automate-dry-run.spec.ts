/* SPDX-License-Identifier: MIT */

import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { startWorkbenchRuntimeTransport } from "../fixtures/workbench-runtime"
import { goto } from "./gate"

// #594: Test runs the drawn workflow through the real Workbench runtime as a dry
// run. The HTTP node targets a real local peer that counts what reaches it: the
// run must report the effect as simulated and the peer must stay untouched.
test("Test simulates the HTTP effect through the real runtime and never reaches the peer", async ({ page, gotoSession }) => {
  let hits = 0
  const peer = createServer((_request, response) => {
    hits++
    response.end(JSON.stringify({ real: true }))
  })
  await new Promise<void>((resolve) => peer.listen(0, "127.0.0.1", resolve))
  const peerPort = (peer.address() as AddressInfo).port
  const transport = await startWorkbenchRuntimeTransport()
  const path = ".unifia/workflows/notify.json"
  const definition = {
    id: "notify",
    version: 1,
    steps: [{ id: "post", family: "tool.http", config: { method: "POST", url: `http://127.0.0.1:${peerPort}/hook` } }],
  }
  try {
    await installWorkbenchMock(page, {
      workspaceId: transport.workspaceId,
      grants: ["workflow.run"],
      files: [{ path, kind: "file" }],
      fileContents: { [path]: JSON.stringify(definition) },
      workflowTransport: { baseUrl: transport.baseUrl, workspaceId: transport.workspaceId, token: transport.token },
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoSession()
    await goto(page, "automate")
    await expect(page.locator('[data-automate-studio-node="post"]')).toBeVisible()

    const test = page.locator('[data-automate-studio-run-bar-action="test"]')
    await expect(test).toBeEnabled()
    const answered = page.waitForResponse((response) => response.url().endsWith("/v1/workflows/dry-run"))
    await test.click()
    const response = await answered
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ dryRun: true, status: "completed", simulatedEffects: [{ method: "POST" }] })

    await expect(page.locator("[data-automate-studio-debug]")).toContainText(`POST http://127.0.0.1:${peerPort}/hook`)
    // A dry run is not a run: the bar never leaves idle and the peer saw nothing.
    await expect(page.locator("[data-automate-studio-run-bar]")).toHaveAttribute("data-automate-studio-run-bar-state", "idle")
    expect(hits).toBe(0)
  } finally {
    await transport.stop()
    await new Promise<void>((resolve) => peer.close(() => resolve()))
  }
})
