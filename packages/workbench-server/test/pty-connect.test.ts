/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { AuditRuntimeDouble, FakeRuntimeAdapter } from "@unifia/contracts"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { UnauthenticatedPrincipal, WorkbenchServer, type WorkbenchPtyConnection, type WorkbenchPtySocket } from "../src/index.js"

describe("scoped PTY WebSocket bridge", () => {
  test("delegates only an authorized workspace connection", async () => {
    const workspace = new WorkspaceRuntime()
    const calls: string[] = []
    const connection: WorkbenchPtyConnection = {
      onMessage: () => calls.push("message"),
      onClose: () => calls.push("close"),
    }
    const surface = {
      list: async () => [],
      create: async () => ({ id: "pty_test", title: "test", command: "sh", args: [], cwd: ".", status: "running" as const, pid: 1 }),
      update: async () => ({ id: "pty_test", title: "test", command: "sh", args: [], cwd: ".", status: "running" as const, pid: 1 }),
      remove: async () => true,
      connect: async (workspaceId: string, ptyId: string, _socket: WorkbenchPtySocket, cursor?: number) => {
        calls.push(`${workspaceId}:${ptyId}:${cursor ?? "none"}`)
        return connection
      },
    }
    const server = new WorkbenchServer({
      auth: new UnauthenticatedPrincipal("test", ["workspace.register", "workspace.open", "workspace.watch"]),
      workspace,
      runtime: new FakeRuntimeAdapter(),
      audit: new AuditRuntimeDouble(),
      capability: { check: async () => "allow" },
      pty: surface,
    })
    const registered = await server.fetch(new Request("http://localhost/v1/workspaces/register", {
      method: "POST",
      body: JSON.stringify({ name: "pty", path: process.cwd() }),
    }))
    const workspaceId = (await registered.json() as { id: string }).id
    const opened = await server.fetch(new Request(`http://localhost/v1/workspaces/${workspaceId}/open`, { method: "POST" }))
    const token = (await opened.json() as { token: string }).token
    const socket: WorkbenchPtySocket = { readyState: 1, send: () => undefined, close: () => undefined }

    const authorized = await server.connectPty(
      new Request("http://localhost/v1/pty/pty_test/connect", { headers: { authorization: `Bearer ${token}` } }),
      workspaceId,
      "pty_test",
      socket,
      12,
    )
    expect(authorized).toBe(connection)
    expect(calls).toEqual([`${workspaceId}:pty_test:12`])

    const denied = await server.connectPty(
      new Request("http://localhost/v1/pty/pty_test/connect"),
      workspaceId,
      "pty_test",
      socket,
    )
    expect(denied).toBeUndefined()
    expect(calls).toHaveLength(1)
  })
})
