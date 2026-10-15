/* SPDX-License-Identifier: MIT */
import { describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { WorkbenchServer } from "../src/index.js"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port.js"

describe("durable workflow HTTP surface (directive 35)", () => {
  it("start/resume/cancel/inspect through the substrate-backed port over HTTP", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-http-"))
    try {
      const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => 1000 })
      const server = new WorkbenchServer({
        auth: { authenticate: async () => ({ id: "u1", kind: "human", scopes: new Set(["workflow.run"]), workspaces: new Set(["ws"]) }) as never },
        workspace: {} as never,
        runtime: {} as never,
        workflow: port,
        audit: { record: () => undefined },
        capability: { check: async () => "allow" },
      })
      const definition = { id: "wf-http-1", version: 1, workspaceId: "ws", steps: [ { id: "s0", capability: "workspace.read", input: {} } ] }
      const started = await server.fetch(new Request("http://127.0.1/v1/workflows", {
        method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(definition),
      }))
      expect(started.status).toBe(201)
      const startedBody = await started.json() as { workflowId: string; authorityToken: object }
      const authority = JSON.stringify(startedBody.authorityToken)
      const inspected = await server.fetch(new Request(`http://127.0.1/v1/workflows/${startedBody.workflowId}`, { headers: { authorization: "Bearer t", "x-workflow-authority-token": authority } }))
      expect(inspected.status).toBe(200)
      const inspectedBody = await inspected.json()
      expect(inspectedBody.versionId).toBeDefined(); expect(inspectedBody.versionDigest).toBeDefined()
      expect(Array.isArray(inspectedBody.events)).toBe(true)
      const cancelled = await server.fetch(new Request(`http://127.0.1/v1/workflows/${startedBody.workflowId}/cancel`, {
         method: "POST", headers: { authorization: "Bearer t", "x-workflow-authority-token": authority }
      }))
      expect(cancelled.status).toBe(200)
      const cancelledBody = await cancelled.json()
      expect(cancelledBody.status).toBe("cancelled")
      port.close()
    } finally {
      Bun.gc(true)
      await new Promise((resolve) => setTimeout(resolve, 100))
      rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
    }
  })

  it("refuses a foreign principal even with a valid workflow authority token, without state or journal changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-http-scope-"))
    const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => 1000 })
    const make = (workspaces: ReadonlySet<string>) => new WorkbenchServer({
      auth: { authenticate: async () => ({ id: "u1", kind: "human", scopes: new Set(["workflow.run"]), workspaces }) as never },
      workspace: {} as never,
      runtime: {} as never,
      workflow: port,
      audit: { record: () => undefined },
      capability: { check: async () => "allow" },
    })
    try {
      const owner = make(new Set(["ws"]))
      const foreign = make(new Set(["other"]))
      const started = await owner.fetch(new Request("http://127.0.0.1/v1/workflows", {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ id: "wf-boundary", version: 1, workspaceId: "ws", steps: [{ id: "step", capability: "workspace.read", input: {} }] }),
      }))
      expect(started.status).toBe(201)
      const run = await started.json() as { workflowId: string; authorityToken: object }
      const url = `http://127.0.0.1/v1/workflows/${run.workflowId}`
      const headers = { authorization: "Bearer t", "x-workflow-authority-token": JSON.stringify(run.authorityToken) }
      const before = await owner.fetch(new Request(url, { headers }))
      expect(before.status).toBe(200)
      const snapshot = await before.json()

      for (const [method, path] of [["GET", ""], ["GET", "/nodes"], ["POST", "/resume"], ["POST", "/cancel"]] as const) {
        const response = await foreign.fetch(new Request(url + path, { method, headers }))
        expect(response.status).toBe(403)
        expect(await response.text()).not.toContain("authorityToken")
      }
      const after = await owner.fetch(new Request(url, { headers }))
      expect(after.status).toBe(200)
      expect(await after.json()).toEqual(snapshot)

      const allowed = await owner.fetch(new Request(url + "/cancel", { method: "POST", headers }))
      expect(allowed.status).toBe(200)
      expect((await allowed.json() as { status: string }).status).toBe("cancelled")
    } finally {
      port.close()
      Bun.gc(true)
      await new Promise((resolve) => setTimeout(resolve, 100))
      rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
    }
  })
})
