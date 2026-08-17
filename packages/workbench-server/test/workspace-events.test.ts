/* SPDX-License-Identifier: MIT */

// C2-2/FUNC-001: GET /v1/workspaces/:workspaceId/events fans in every
// session's events into one stream, and periodically re-lists sessions to
// join ones created after the stream opened (RuntimeAdapter has no "session
// created" push notification). Exercised against the real FakeRuntimeAdapter
// and WorkspaceRuntime, not mocks.

import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FakeRuntimeAdapter } from "@unifia/contracts"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { UnauthenticatedPrincipal, WorkbenchServer } from "../src/index.js"

async function readFrames(response: Response, count: number): Promise<Record<string, unknown>[]> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const frames: Record<string, unknown>[] = []
  let buffer = ""
  while (frames.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      const data = part.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
      if (data) frames.push(JSON.parse(data))
    }
  }
  await reader.cancel()
  return frames
}

describe("GET /v1/workspaces/:workspaceId/events (C2-2/FUNC-001)", () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "unifia-workspace-events-")) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  async function open(server: WorkbenchServer) {
    const registered = await server.fetch(new Request("http://localhost/v1/workspaces/register", { method: "POST", body: JSON.stringify({ name: "fixture", path: root }) }))
    const { id } = (await registered.json()) as { id: string }
    const opened = await server.fetch(new Request(`http://localhost/v1/workspaces/${id}/open`, { method: "POST" }))
    return (await opened.json()) as { id: string; token: string }
  }

  it("fans in events from every session that exists when the stream opens", async () => {
    const runtime = new FakeRuntimeAdapter(() => 1_000)
    const server = new WorkbenchServer({ auth: new UnauthenticatedPrincipal("anonymous", ["workspace.register", "workspace.open", "workspace.read", "workspace.watch"]), workspace: new WorkspaceRuntime(), runtime, audit: { record: () => undefined }, capability: { check: async () => "allow" } })
    const handle = await open(server)
    const sessionA = await runtime.createSession({ workspaceId: handle.id })
    const sessionB = await runtime.createSession({ workspaceId: handle.id })

    const response = await server.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/events`, { headers: { authorization: `Bearer ${handle.token}` } }))
    expect(response.status).toBe(200)

    await runtime.sendPrompt({ sessionId: sessionA.id, prompt: "from A" })
    await runtime.sendPrompt({ sessionId: sessionB.id, prompt: "from B" })

    const frames = await readFrames(response, 2)
    const sessionIds = frames.map((frame) => frame.sessionId).sort()
    expect(sessionIds).toEqual([sessionA.id, sessionB.id].sort())
  })

  it("joins a session created after the stream opened, within one poll interval", async () => {
    const runtime = new FakeRuntimeAdapter(() => 1_000)
    const server = new WorkbenchServer({
      auth: new UnauthenticatedPrincipal("anonymous", ["workspace.register", "workspace.open", "workspace.read", "workspace.watch"]),
      workspace: new WorkspaceRuntime(),
      runtime,
      audit: { record: () => undefined },
      capability: { check: async () => "allow" },
      workspaceEventsPollMs: 20,
    })
    const handle = await open(server)

    const response = await server.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/events`, { headers: { authorization: `Bearer ${handle.token}` } }))
    expect(response.status).toBe(200)

    // Created after the stream opened — only the poll can discover it.
    await new Promise((resolve) => setTimeout(resolve, 40))
    const sessionLate = await runtime.createSession({ workspaceId: handle.id })
    await new Promise((resolve) => setTimeout(resolve, 40))
    await runtime.sendPrompt({ sessionId: sessionLate.id, prompt: "joined late" })

    const [frame] = await readFrames(response, 1)
    expect(frame?.sessionId).toBe(sessionLate.id)
  })

  it("rejects a caller without a valid workspace token", async () => {
    const server = new WorkbenchServer({ auth: new UnauthenticatedPrincipal("anonymous", ["workspace.register", "workspace.open", "workspace.read", "workspace.watch"]), workspace: new WorkspaceRuntime(), runtime: new FakeRuntimeAdapter(() => 1_000), audit: { record: () => undefined }, capability: { check: async () => "allow" } })
    const handle = await open(server)
    const response = await server.fetch(new Request(`http://localhost/v1/workspaces/${handle.id}/events`))
    expect(response.status).toBe(403)
  })
})
