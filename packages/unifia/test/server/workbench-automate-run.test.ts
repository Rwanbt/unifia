/* SPDX-License-Identifier: MIT */

// The Automate studio's whole run path, exercised with the real WorkbenchClient
// against the bridge the sidecar ships: start (with the approval the broker
// asks for), drive, list and cancel. Green unit suites had hidden that the
// server never received a workflow runtime and that resume/cancel could not
// carry their ownership token.
//
// The lease adds `workflow.run` on purpose: the app's own lease does not carry
// it and the server refuses it before the approval gate (2026-08-17 decision,
// pinned by workbench-server capability-scope.test.ts). This test covers
// everything behind that decision, so lifting it is a one-line change.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SURFACE_LEASE_CAPABILITIES, WorkbenchClient, workflowAuthorityOf } from "@unifia/workbench-shell"
import { createWorkbenchBridge } from "../../src/server/workbench"

const PASSWORD = "unifia-automate-run-password-0123456789"
const ENV_KEYS = ["UNIFIA_SERVER_PASSWORD", "UNIFIA_KEYCHAIN_TOKEN", "UNIFIA_WORKBENCH_BEARER", "UNIFIA_WORKBENCH_AUDIT_LOG"] as const
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
let root = ""

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "unifia-automate-run-"))
  await mkdir(path.join(root, "workspace"))
  process.env.UNIFIA_WORKBENCH_AUDIT_LOG = path.join(root, "workbench-audit.jsonl")
  process.env.UNIFIA_SERVER_PASSWORD = PASSWORD
  delete process.env.UNIFIA_KEYCHAIN_TOKEN
  delete process.env.UNIFIA_WORKBENCH_BEARER
})

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const post = (body: unknown) =>
  new Request("http://127.0.0.1/workbench-web/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

describe("AutomateRunPath_ShippedBridge", () => {
  test("start, drive, list and cancel a run through the real client", async () => {
    const bridge = createWorkbenchBridge()
    if (!bridge) throw new Error("bridge did not initialize")
    try {
      const opened = await bridge.web(post({ action: "open", workspacePath: path.join(root, "workspace") }))
      const { workspaceId, instanceId } = (await opened.json()) as { workspaceId: string; instanceId: string }
      const issued = await bridge.web(post({ action: "issue", workspaceId, capabilities: [...SURFACE_LEASE_CAPABILITIES, "workflow.run"] }))
      const lease = (await issued.json()) as { token: string }
      const client = new WorkbenchClient({
        baseUrl: "http://127.0.0.1/workbench",
        instanceId,
        token: { current: () => lease.token, refresh: async () => lease.token },
        fetchImpl: ((input: string, init?: RequestInit) => bridge.fetch(new Request(input, init))) as unknown as typeof fetch,
      })

      const definition = { id: "wf-e2e", version: 1, steps: [{ id: "gate", family: "human.approval", config: {} }] }
      let started = await client.startWorkflow(workspaceId, definition)
      if ("approvalRequired" in started) {
        await client.resolveApproval(started.approvalId, "allow")
        started = await client.startWorkflow(workspaceId, definition)
      }
      if ("approvalRequired" in started) throw new Error("the run still asks for approval after it was allowed")
      const authority = workflowAuthorityOf(started.state)
      if (!authority) throw new Error("the server returned no ownership token")
      expect(started.state.status).toBe("running")

      const driven = await client.runWorkflow(authority)
      expect(driven.status).toBe("running")

      const listed = await client.listWorkflows()
      expect(listed.workflows.map((run) => run.workflowId)).toContain(authority.workflowRunId)

      const cancelled = await client.updateWorkflow(authority.workflowRunId, "cancel", { workspaceId, authority })
      expect(cancelled.state.status).toBe("cancelled")
    } finally {
      await bridge.app.server.shutdown()
    }
  })

  test("a drawn branch and join run as drawn through the real client (CR04)", async () => {
    const bridge = createWorkbenchBridge()
    if (!bridge) throw new Error("bridge did not initialize")
    try {
      const opened = await bridge.web(post({ action: "open", workspacePath: path.join(root, "workspace") }))
      const { workspaceId, instanceId } = (await opened.json()) as { workspaceId: string; instanceId: string }
      const issued = await bridge.web(post({ action: "issue", workspaceId, capabilities: [...SURFACE_LEASE_CAPABILITIES, "workflow.run"] }))
      const lease = (await issued.json()) as { token: string }
      const client = new WorkbenchClient({
        baseUrl: "http://127.0.0.1/workbench",
        instanceId,
        token: { current: () => lease.token, refresh: async () => lease.token },
        fetchImpl: ((input: string, init?: RequestInit) => bridge.fetch(new Request(input, init))) as unknown as typeof fetch,
      })
      const transform = (id: string, field: string, expression: string) => ({ id, family: "tool.transform", config: { fields: { [field]: expression } } })
      const definition = {
        id: "wf-graph",
        version: 1,
        steps: [
          transform("count", "n", "3"),
          { id: "gate", family: "control.if", config: { condition: "$node.count.json.n > 2" } },
          transform("big", "v", "1"),
          transform("small", "v", "0"),
          { id: "join", family: "control.merge", config: { strategy: "any", branches: ["big", "small"] } },
          transform("after", "done", "true"),
        ],
        edges: [
          { from: "count", to: "gate" },
          { from: "gate", to: "big", kind: "branch-true" },
          { from: "gate", to: "small", kind: "branch-false" },
          { from: "big", to: "join" },
          { from: "small", to: "join" },
          { from: "join", to: "after" },
        ],
      }
      let started = await client.startWorkflow(workspaceId, definition)
      if ("approvalRequired" in started) {
        await client.resolveApproval(started.approvalId, "allow")
        started = await client.startWorkflow(workspaceId, definition)
      }
      if ("approvalRequired" in started) throw new Error("the run still asks for approval after it was allowed")
      const authority = workflowAuthorityOf(started.state)
      if (!authority) throw new Error("the server returned no ownership token")

      const driven = await client.runWorkflow(authority)
      expect(driven.status).toBe("completed")
      // one output per step, in step order: the branch not taken has none
      const outputs = (driven as unknown as { outputs: unknown[] }).outputs
      expect(outputs).toHaveLength(6)
      expect(outputs[2]).not.toBeNull()
      expect(outputs[3]).toBeNull()
    } finally {
      await bridge.app.server.shutdown()
    }
  })

  test("a run from an earlier session is reclaimed by its owner and cancelled without a stored token (CR05)", async () => {
    const bridge = createWorkbenchBridge()
    if (!bridge) throw new Error("bridge did not initialize")
    try {
      const opened = await bridge.web(post({ action: "open", workspacePath: path.join(root, "workspace") }))
      const { workspaceId, instanceId } = (await opened.json()) as { workspaceId: string; instanceId: string }
      const issued = await bridge.web(post({ action: "issue", workspaceId, capabilities: [...SURFACE_LEASE_CAPABILITIES, "workflow.run"] }))
      const lease = (await issued.json()) as { token: string }
      const newClient = () =>
        new WorkbenchClient({
          baseUrl: "http://127.0.0.1/workbench",
          instanceId,
          token: { current: () => lease.token, refresh: async () => lease.token },
          fetchImpl: ((input: string, init?: RequestInit) => bridge.fetch(new Request(input, init))) as unknown as typeof fetch,
        })

      const definition = { id: "wf-reclaim", version: 1, steps: [{ id: "gate", family: "human.approval", config: {} }] }
      const first = newClient()
      let started = await first.startWorkflow(workspaceId, definition)
      if ("approvalRequired" in started) {
        await first.resolveApproval(started.approvalId, "allow")
        started = await first.startWorkflow(workspaceId, definition)
      }
      if ("approvalRequired" in started) throw new Error("the run still asks for approval after it was allowed")
      const runId = workflowAuthorityOf(started.state)?.workflowRunId
      if (!runId) throw new Error("the server returned no ownership token")

      // a later session: a new client, nothing carried over but the run id from the list
      const later = newClient()
      const listed = await later.listWorkflows()
      expect(listed.workflows.map((run) => run.workflowId)).toContain(runId)
      const reclaimed = await later.reclaimWorkflow(workspaceId, runId)
      const authority = workflowAuthorityOf(reclaimed.state)
      expect(authority?.workflowRunId).toBe(runId)
      const cancelled = await later.updateWorkflow(runId, "cancel", { workspaceId, authority: authority! })
      expect(cancelled.state.status).toBe("cancelled")

      // a run id from another workspace scope is refused, never faked
      await expect(later.reclaimWorkflow("other-workspace", runId)).rejects.toThrow()
    } finally {
      await bridge.app.server.shutdown()
    }
  })
})
