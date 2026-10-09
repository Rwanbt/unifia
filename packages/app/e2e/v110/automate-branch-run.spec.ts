/* SPDX-License-Identifier: MIT */

import type { Page, Request, Response } from "@playwright/test"
import { test, expect } from "../fixtures"
import { installWorkbenchMock } from "../fixtures/workbench-mock"
import { startWorkbenchRuntimeTransport, type WorkbenchRuntimeTransport } from "../fixtures/workbench-runtime"
import { goto, track } from "./gate"

const DEFINITION_PATH = ".unifia/workflows/cr04-browser-branch.json"
const DEFINITION = {
  id: "cr04-browser-branch",
  version: 1,
  steps: [
    { id: "count", family: "tool.transform", config: { fields: { n: "3" } } },
    { id: "big", family: "tool.transform", config: { fields: { branch: '\"true\"' } } },
    { id: "small", family: "tool.transform", config: { fields: { branch: '\"false\"' } } },
    { id: "after", family: "tool.transform", config: { fields: { done: "true" } } },
  ],
}

async function addNode(page: Page, family: string): Promise<string> {
  const nodes = page.locator("[data-automate-studio-node]")
  const before = await nodes.count()
  await page.locator(`[data-automate-studio-library-entry="${family}"]`).click()
  await expect(nodes).toHaveCount(before + 1)
  const id = await page.locator('[data-automate-studio-node-selected="true"]').getAttribute("data-automate-studio-node")
  if (!id) throw new Error(`new ${family} node was not selected`)
  return id
}

async function configureGraphNodes(page: Page): Promise<{ conditionalId: string; mergeId: string }> {
  const conditionalId = await addNode(page, "control.if")
  const condition = page.locator('[data-automate-node-config-field="condition"]')
  await expect(condition).toBeVisible()
  await condition.fill("$node.count.json.n > 2")

  const mergeId = await addNode(page, "control.merge")
  const strategy = page.locator('[data-automate-node-config-field="strategy"]')
  await expect(strategy).toBeVisible()
  await strategy.selectOption("any")
  return { conditionalId, mergeId }
}

async function drawEdge(page: Page, from: string, kind: string, to: string): Promise<void> {
  const source = page.locator(`[data-automate-studio-port="${from}:out:${kind}"]`)
  const target = page.locator(`[data-automate-studio-port="${to}:in"]`)
  const start = await source.boundingBox()
  const end = await target.boundingBox()
  if (!start || !end) throw new Error(`missing canvas port for ${from} -> ${to}`)
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator(`[data-automate-studio-edge="${from}->${to}"][data-automate-studio-edge-kind="${kind}"]`)).toHaveCount(1)
}

async function drawConditionalGraph(page: Page, ids: { conditionalId: string; mergeId: string }): Promise<void> {
  await drawEdge(page, "count", "flow", ids.conditionalId)
  await drawEdge(page, ids.conditionalId, "branch-true", "big")
  await drawEdge(page, ids.conditionalId, "branch-false", "small")
  await drawEdge(page, "big", "flow", ids.mergeId)
  await drawEdge(page, "small", "flow", ids.mergeId)
  await drawEdge(page, ids.mergeId, "flow", "after")
}

function expectTransportDefinition(request: Request, ids: { conditionalId: string; mergeId: string }): void {
  const sent = request.postDataJSON() as { definition: { steps: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } }
  const gate = sent.definition.steps.find((step) => step.id === ids.conditionalId)
  const merge = sent.definition.steps.find((step) => step.id === ids.mergeId)
  expect(gate?.config).toEqual({ condition: "$node.count.json.n > 2" })
  expect(merge?.config).toEqual({ strategy: "any", branches: ["big", "small"] })
  expect(sent.definition.edges).toEqual([
    { from: "count", to: ids.conditionalId, kind: "flow" },
    { from: ids.conditionalId, to: "big", kind: "branch-true" },
    { from: ids.conditionalId, to: "small", kind: "branch-false" },
    { from: "big", to: ids.mergeId, kind: "flow" },
    { from: "small", to: ids.mergeId, kind: "flow" },
    { from: ids.mergeId, to: "after", kind: "flow" },
  ])
}

async function nodeStatuses(transport: WorkbenchRuntimeTransport, response: Response): Promise<Record<string, string>> {
  const state = (await response.json()) as {
    state: { workflowId: string; authorityToken: Record<string, unknown> }
  }
  const details = await fetch(`${transport.baseUrl}/v1/workflows/${state.state.workflowId}/nodes`, {
    headers: {
      authorization: `Bearer ${transport.token}`,
      "x-workflow-authority-token": JSON.stringify(state.state.authorityToken),
    },
  })
  if (!details.ok) throw new Error(`workflow node inspection returned HTTP ${details.status}`)
  const body = (await details.json()) as { nodes: Array<{ nodeId: string; status: string }> }
  return Object.fromEntries(body.nodes.map((node) => [node.nodeId, node.status]))
}

test("automate draws and runs the selected conditional branch through Workbench", async ({ page, gotoSession }) => {
  const transport = await startWorkbenchRuntimeTransport()
  const requestFailures: string[] = []
  const errors: string[] = []
  const tracking = track(page)
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(transport.baseUrl)) requestFailures.push(`${request.url()}: ${request.failure()?.errorText}`)
  })
  page.on("pageerror", (error) => errors.push(error.message))

  try {
    await installWorkbenchMock(page, {
      workspaceId: transport.workspaceId,
      grants: ["workflow.run"],
      files: [{ path: DEFINITION_PATH, kind: "file" }],
      fileContents: { [DEFINITION_PATH]: JSON.stringify(DEFINITION) },
      workflowTransport: {
        baseUrl: transport.baseUrl,
        workspaceId: transport.workspaceId,
        token: transport.token,
      },
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoSession()
    await goto(page, "automate")
    await expect(page.locator('[data-workbench-surface="automate"]')).toBeVisible()
    await expect(page.locator('[data-automate-studio-node="count"]')).toBeVisible()
    const ids = await configureGraphNodes(page)
    await page.getByRole("button", { name: "Close" }).click()
    await page.getByRole("button", { name: "Zoom to fit" }).click()
    await drawConditionalGraph(page, ids)

    const startRequest = page.waitForRequest(
      (request) => request.url() === `${transport.baseUrl}/v1/workflows/start` && request.method() === "POST",
    )
    const startResponse = page.waitForResponse(
      (response) => response.url() === `${transport.baseUrl}/v1/workflows/start` && response.request().method() === "POST",
    )
    await page.locator('[data-automate-studio-run-bar-action="start"]').click()
    const [request, response] = await Promise.all([startRequest, startResponse])
    expect(response.status()).toBe(202)
    expectTransportDefinition(request, ids)
    await expect.poll(() => nodeStatuses(transport, response)).toMatchObject({
      count: "COMPLETED",
      [ids.conditionalId]: "COMPLETED",
      big: "COMPLETED",
      small: "SKIPPED",
      [ids.mergeId]: "COMPLETED",
      after: "COMPLETED",
    })
    expect(requestFailures).toEqual([])
    expect(errors).toEqual([])
    expect(tracking.pages).toEqual([])
    expect(tracking.logs).toEqual([])
  } finally {
    tracking.stop()
    await transport.stop()
  }
})
