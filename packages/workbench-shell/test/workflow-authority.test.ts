/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { WORKBENCH_REQUEST_HEADERS } from "@unifia/contracts/workbench-wire"
import { WorkbenchClient, workflowAuthorityOf, type WorkflowAuthority } from "../src/index.js"

const authority: WorkflowAuthority = { workflowRunId: "run-1", authorityOwnerId: "owner-1", generation: 3 }

function clientRecording(): { client: WorkbenchClient; seen: { url: string; headers: Record<string, string>; body: unknown }[] } {
  const seen: { url: string; headers: Record<string, string>; body: unknown }[] = []
  const client = new WorkbenchClient({
    baseUrl: "http://127.0.0.1:7444",
    instanceId: "instance-1",
    token: { current: () => "lease", refresh: async () => "lease" },
    fetchImpl: async (input, init) => {
      seen.push({ url: new URL(String(input)).pathname, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ state: { workflowId: "run-1", status: "cancelled" }, workflowId: "run-1", status: "running" }), { status: 200, headers: { "content-type": "application/json" } })
    },
  })
  return { client, seen }
}

describe("WorkflowAuthority_ClientWire", () => {
  test("cancel sends the workspace and the ownership token the server requires", async () => {
    const { client, seen } = clientRecording()
    await client.updateWorkflow("run-1", "cancel", { workspaceId: "ws-1", authority })
    expect(seen[0]?.url).toBe("/v1/workflows/cancel")
    expect(seen[0]?.body).toEqual({ workflowId: "run-1", workspaceId: "ws-1" })
    expect(JSON.parse(seen[0]?.headers["x-workflow-authority-token"] ?? "null")).toEqual(authority)
  })

  test("run drives the started workflow with its token", async () => {
    const { client, seen } = clientRecording()
    await client.runWorkflow(authority)
    expect(seen[0]?.url).toBe("/v1/workflows/run-1/run")
    expect(JSON.parse(seen[0]?.headers["x-workflow-authority-token"] ?? "null")).toEqual(authority)
  })

  test("the authority header is on the CORS allowlist, so a browser preflight lets it through", () => {
    expect(WORKBENCH_REQUEST_HEADERS).toContain("x-workflow-authority-token")
  })

  test("workflowAuthorityOf accepts a complete token and refuses a partial one", () => {
    expect(workflowAuthorityOf({ workflowId: "run-1", status: "running", authorityToken: authority })).toEqual(authority)
    expect(workflowAuthorityOf({ workflowId: "run-1", status: "running" })).toBeUndefined()
    expect(workflowAuthorityOf({ workflowId: "run-1", status: "running", authorityToken: { workflowRunId: "run-1" } })).toBeUndefined()
  })
})
