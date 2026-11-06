/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * POST /v1/workflows/:id/complete: a person lets a waiting node through.
 * Before this route, an approval, wait or manual-trigger node stayed RUNNING
 * for ever — the engine left it to "an external event" nothing delivered.
 * These tests drive the real engine through HTTP, start to completion.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { AuthorityToken } from "@unifia/workflow-runtime"
import { WorkbenchServer } from "../src/index.js"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port.js"

type RunBody = { status: string; waitingFor: { nodeId: string; family: string }[] }

function makeServer(port: NativeWorkflowRuntimePort, check: () => Promise<"allow" | "deny"> = async () => "allow"): WorkbenchServer {
  return new WorkbenchServer({
    auth: { authenticate: async () => ({ id: "owner-a", kind: "human", scopes: new Set(["workflow.run"]), workspaces: new Set(["ws"]) }) as never },
    workspace: {} as never,
    runtime: {} as never,
    workflow: port,
    audit: { record: () => undefined },
    capability: { check: check as never },
  })
}

const headers = (token: AuthorityToken) => ({ authorization: "Bearer test", "x-workflow-authority-token": JSON.stringify(token) })

async function withRun(steps: unknown[], body: (server: WorkbenchServer, token: AuthorityToken, port: NativeWorkflowRuntimePort) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "unifia-complete-"))
  const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "w.sqlite"), now: () => 1000 })
  try {
    const server = makeServer(port)
    const started = await server.fetch(new Request("http://127.0.0.1/v1/workflows", {
      method: "POST",
      headers: { authorization: "Bearer test", "content-type": "application/json" },
      body: JSON.stringify({ id: "gated", version: 1, workspaceId: "ws", steps }),
    }))
    expect(started.status).toBe(201)
    const token = ((await started.json()) as { authorityToken: AuthorityToken }).authorityToken
    await body(server, token, port)
  } finally {
    port.close()
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    } catch {
      // WHY: Windows keeps the SQLite file locked for a moment after close; the temp dir is disposable.
    }
  }
}

const run = (server: WorkbenchServer, token: AuthorityToken) =>
  server.fetch(new Request(`http://127.0.0.1/v1/workflows/${token.workflowRunId}/run`, { method: "POST", headers: headers(token) }))
const complete = (server: WorkbenchServer, token: AuthorityToken, nodeId: unknown) =>
  server.fetch(new Request(`http://127.0.0.1/v1/workflows/${token.workflowRunId}/complete`, {
    method: "POST",
    headers: { ...headers(token), "content-type": "application/json" },
    body: JSON.stringify({ nodeId }),
  }))

describe("WorkflowComplete_WaitingNode", () => {
  test("approving each waiting node drives the run to completion", async () => {
    await withRun([{ id: "gate", family: "human.approval" }, { id: "pause", family: "wait" }], async (server, token) => {
      const driven = (await (await run(server, token)).json()) as RunBody
      expect(driven.status).toBe("running")
      expect(driven.waitingFor).toEqual([{ nodeId: "gate", family: "human.approval" }])

      const first = await complete(server, token, "gate")
      expect(first.status).toBe(200)
      const afterGate = (await first.json()) as RunBody
      expect(afterGate.waitingFor).toEqual([{ nodeId: "pause", family: "wait" }])

      const second = (await (await complete(server, token, "pause")).json()) as RunBody
      expect(second.status).toBe("completed")
      expect(second.waitingFor).toEqual([])
    })
  })

  test("a node that is not waiting is refused with 409, and nothing moves", async () => {
    await withRun([{ id: "gate", family: "human.approval" }, { id: "pause", family: "wait" }], async (server, token) => {
      await run(server, token)
      const early = await complete(server, token, "pause")
      expect(early.status).toBe(409)
      expect(await early.json()).toEqual({ error: "NODE_NOT_WAITING" })
      const unknown = await complete(server, token, "nope")
      expect(unknown.status).toBe(409)
      const inspected = (await (await server.fetch(new Request(`http://127.0.0.1/v1/workflows/${token.workflowRunId}`, { headers: headers(token) }))).json()) as RunBody
      expect(inspected.waitingFor).toEqual([{ nodeId: "gate", family: "human.approval" }])
    })
  })

  test("a missing node id or token is a 400", async () => {
    await withRun([{ id: "gate", family: "human.approval" }], async (server, token) => {
      await run(server, token)
      expect((await complete(server, token, "")).status).toBe(400)
      const noToken = await server.fetch(new Request(`http://127.0.0.1/v1/workflows/${token.workflowRunId}/complete`, {
        method: "POST",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: JSON.stringify({ nodeId: "gate" }),
      }))
      expect(noToken.status).toBe(400)
    })
  })

  test("a cancelled run cannot be released", async () => {
    await withRun([{ id: "gate", family: "human.approval" }], async (server, token, port) => {
      await run(server, token)
      await port.cancel(token)
      expect((await complete(server, token, "gate")).status).toBe(409)
    })
  })
})
