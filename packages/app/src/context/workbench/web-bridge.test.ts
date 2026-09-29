/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import { createWebWorkbenchBridge, WEB_BRIDGE_ROUTE, WebWorkbenchBridgeUnavailableError } from "./web-bridge"

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

type Seen = { url: string; authorization: string | null; body: Record<string, unknown> }

function mockFetch(respond: (seen: Seen) => Response, seen: Seen[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const entry = {
      url: String(input),
      authorization: headers.get("Authorization"),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    }
    seen.push(entry)
    return respond(entry)
  }) as typeof fetch
}

describe("createWebWorkbenchBridge (ADR-041)", () => {
  test("opens the workspace through the web route with the server credentials", async () => {
    const seen: Seen[] = []
    mockFetch((entry) => {
      if (entry.body.action === "open") return Response.json({ workspaceId: "ws-1", instanceId: "inst-1" })
      return new Response("boom", { status: 500 })
    }, seen)
    const bridge = createWebWorkbenchBridge(() => ({ url: "http://127.0.0.1:4099/", authorization: "Basic abc" }))

    await expect(bridge.connect({ workspacePath: "D:/repo", capabilities: ["workspace.read"] })).rejects.toThrow(
      /issue failed \(500\): boom/,
    )
    expect(seen[0]).toEqual({
      url: `http://127.0.0.1:4099${WEB_BRIDGE_ROUTE}`,
      authorization: "Basic abc",
      body: { action: "open", workspacePath: "D:/repo" },
    })
    expect(seen[1].body).toEqual({ action: "issue", workspaceId: "ws-1", capabilities: ["workspace.read"] })
  })

  test("a sidecar without a password (404) surfaces a dedicated error", async () => {
    mockFetch(() => new Response("not found", { status: 404 }), [])
    const bridge = createWebWorkbenchBridge(() => ({ url: "http://127.0.0.1:4099" }))
    await expect(bridge.connect({ workspacePath: "D:/repo", capabilities: [] })).rejects.toBeInstanceOf(
      WebWorkbenchBridgeUnavailableError,
    )
  })

  test("no credentials means no Authorization header, never an empty one", async () => {
    const seen: Seen[] = []
    mockFetch(() => new Response("not found", { status: 404 }), seen)
    const bridge = createWebWorkbenchBridge(() => ({ url: "http://127.0.0.1:4099" }))
    await bridge.connect({ workspacePath: "D:/repo", capabilities: [] }).catch(() => undefined)
    expect(seen[0].authorization).toBeNull()
  })
})
