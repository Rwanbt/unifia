/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * POST /v1/workflows/dry-run (#594): the real engine, registry and capability
 * gate, with no external effect and no durable run. The only test double is
 * the upstream HTTP peer, a real local server that counts what reaches it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ScopedTokenIssuer, WorkbenchServer } from "../src/index.js"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port.js"
import { DRY_RUN_RECEIPT } from "../src/dry-run.js"

type Decision = "allow" | "deny"

let hits = 0
let peer: ReturnType<typeof Bun.serve>
beforeAll(() => {
  peer = Bun.serve({ port: 0, fetch: () => { hits++; return Response.json({ real: true }) } })
})
afterAll(() => peer.stop(true))

const dir = mkdtempSync(join(tmpdir(), "unifia-dry-run-test-"))
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))

function makeServer(port: NativeWorkflowRuntimePort, decide: (capability: string) => Decision = () => "allow"): WorkbenchServer {
  return new WorkbenchServer({
    auth: { authenticate: async () => ({ id: "owner-a", kind: "human", scopes: new Set(["workflow.run"]), workspaces: "*" }) as never },
    tokenIssuer: new ScopedTokenIssuer("x".repeat(32), 60_000, 30_000),
    workspace: { open: async (id: string) => ({ id, token: `runtime-${id}` }), close: async () => undefined } as never,
    runtime: {} as never,
    workflow: port,
    audit: { record: () => undefined },
    capability: { check: (async (capability: string) => decide(capability)) as never },
  })
}

const dryRun = async (server: WorkbenchServer, steps: unknown[], workspaceId = "ws") => {
  const { token } = await server.issueNativeScopedToken({ principalId: "owner-a", workspaceId: "ws", capabilities: ["workflow.run"] })
  return server.fetch(new Request("http://127.0.0.1/v1/workflows/dry-run", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, definition: { id: "wf", version: 1, steps } }),
  }))
}

const httpStep = (id: string) => ({
  id,
  capability: "network.request",
  input: {},
  family: "tool.http",
  config: { method: "POST", url: `http://127.0.0.1:${peer.port}/orders` },
})

describe("WorkflowDryRun", () => {
  test("an HTTP node is simulated: the run completes, the effect is reported, the peer is never reached", async () => {
    const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "a.sqlite") })
    try {
      const response = await dryRun(makeServer(port), [httpStep("call")])
      expect(response.status).toBe(200)
      const report = (await response.json()) as Record<string, unknown>
      expect(report.dryRun).toBe(true)
      expect(report.status).toBe("completed")
      expect(report.simulatedEffects).toEqual([{ nodeEffect: "http", method: "POST", url: `http://127.0.0.1:${peer.port}/orders` }])
      expect(hits).toBe(0)
      // Not a committed run: the durable run list stays empty.
      expect(await port.listWorkflows()).toEqual([])
    } finally {
      port.close()
    }
  })

  test("a refused node capability refuses the dry run exactly as it refuses a run", async () => {
    const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "b.sqlite") })
    try {
      const response = await dryRun(makeServer(port, (capability) => (capability === "network.request" ? "deny" : "allow")), [httpStep("call")])
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: "NODE_CAPABILITY_DENIED", dryRun: true })
      expect(hits).toBe(0)
    } finally {
      port.close()
    }
  })

  test("an approval stops the dry run and names the node, as a real run does", async () => {
    const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "c.sqlite") })
    try {
      const response = await dryRun(makeServer(port), [{ id: "gate", family: "human.approval" }, httpStep("after")])
      const report = (await response.json()) as { status: string; waitingFor: unknown; simulatedEffects: unknown[] }
      expect(report.status).toBe("running")
      expect(report.waitingFor).toEqual([{ nodeId: "gate", family: "human.approval" }])
      // The effect behind the approval is not even simulated: the gate holds.
      expect(report.simulatedEffects).toEqual([])
    } finally {
      port.close()
    }
  })

  test("the workflow.run gate applies before anything runs", async () => {
    const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "d.sqlite") })
    try {
      const response = await dryRun(makeServer(port, (capability) => (capability === "workflow.run" ? "deny" : "allow")), [httpStep("call")])
      expect(response.status).toBe(403)
      expect(hits).toBe(0)
    } finally {
      port.close()
    }
  })

  test("a token for another workspace is refused", async () => {
    const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "e.sqlite") })
    try {
      expect((await dryRun(makeServer(port), [httpStep("call")], "other-ws")).status).toBe(403)
      expect(hits).toBe(0)
    } finally {
      port.close()
    }
  })

  test("the simulated receipt is fixed", () => {
    expect(DRY_RUN_RECEIPT).toEqual({ simulated: true, dryRun: true })
  })
})
