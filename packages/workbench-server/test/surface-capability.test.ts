/* SPDX-License-Identifier: MIT */

// Phases 12/17 added the design-skills and GitHub surfaces. Each declares a
// capability in the route registry (workbench-shell/routes.ts: M23/M25) but
// the handlers only ever called #authorize — the workspace scope check — and
// never #checkCapability, the gate every other route in this server pairs
// with it. A workspace-scoped token therefore reached the GitHub device flow
// with no capability decision taken at all, and a CapabilityGate answering
// "deny" changed nothing. (The scoped PTY mirror had the same hole; it was
// removed outright — the Design terminal reaches the sidecar's own /pty
// routes directly, so the mirror was unused duplication.)
//
// These tests pin the enforcement to the capability the registry declares.

import { describe, expect, it } from "vitest"
import { ScopedTokenIssuer, WorkbenchServer, type WorkbenchGithubSurface } from "../src/index.js"

const WORKSPACE_ID = "ws-1"
const READ_ONLY_CAPABILITIES = ["workspace.read", "workspace.watch"]
const WRITE_CAPABILITIES = [...READ_ONLY_CAPABILITIES, "workspace.write"]

function makeSurfaces(reached: string[]): { designSkills: () => Promise<never[]>; github: WorkbenchGithubSurface } {
  return {
    designSkills: async () => { reached.push("design-skills"); return [] },
    github: {
      status: async () => { reached.push("github.status"); return { connected: false, configured: false } },
      deviceStart: async () => { reached.push("github.deviceStart"); return { userCode: "TEST-CODE" } },
      devicePoll: async () => { reached.push("github.devicePoll"); return {} },
      deviceCancel: async () => { reached.push("github.deviceCancel"); return { ok: true } },
      disconnect: async () => { reached.push("github.disconnect"); return { ok: true } },
    },
  }
}

function makeServer(reached: string[], check: (capability: string) => "allow" | "deny") {
  return new WorkbenchServer({
    auth: { authenticate: async () => undefined },
    tokenIssuer: new ScopedTokenIssuer("x".repeat(32), 60_000, 30_000),
    workspace: { open: async (id: string) => ({ id, token: `runtime-${id}` }) } as never,
    runtime: {} as never,
    audit: { record: () => undefined },
    capability: { check: async (capability) => check(capability) },
    ...makeSurfaces(reached),
  })
}

async function issueToken(server: WorkbenchServer, capabilities: readonly string[]) {
  const issued = await server.issueNativeScopedToken({ principalId: "principal-1", workspaceId: WORKSPACE_ID, capabilities })
  return issued.token
}

type Call = { name: string; method: "GET" | "POST" | "PUT" | "DELETE"; path: string; body?: Record<string, unknown>; surface: string }

/** Registry capability workspace.read — held by the base Design/Work lease (READ_CAPABILITIES, provider.tsx). */
const READ_CALLS: readonly Call[] = [
  { name: "design-skills", method: "GET", path: `/v1/design-skills?workspaceId=${WORKSPACE_ID}`, surface: "design-skills" },
  { name: "github.status", method: "GET", path: `/v1/github/status?workspaceId=${WORKSPACE_ID}`, surface: "github.status" },
]

/** Registry capability workspace.write — NOT held by the base lease and not step-up eligible, so it must fail closed. */
const WRITE_CALLS: readonly Call[] = [
  { name: "github.device/start", method: "POST", path: "/v1/github/device/start", body: { workspaceId: WORKSPACE_ID }, surface: "github.deviceStart" },
  { name: "github.device/poll", method: "POST", path: "/v1/github/device/poll", body: { workspaceId: WORKSPACE_ID }, surface: "github.devicePoll" },
  { name: "github.device/cancel", method: "POST", path: "/v1/github/device/cancel", body: { workspaceId: WORKSPACE_ID }, surface: "github.deviceCancel" },
  { name: "github.disconnect", method: "POST", path: "/v1/github/disconnect", body: { workspaceId: WORKSPACE_ID }, surface: "github.disconnect" },
]

function send(server: WorkbenchServer, call: Call, token: string): Promise<Response> {
  return server.fetch(new Request(`http://localhost${call.path}`, {
    method: call.method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: call.body === undefined ? undefined : JSON.stringify(call.body),
  }))
}

describe("Phase 12/17 surfaces run through the capability gate", () => {
  it.each(READ_CALLS)("$name serves a read-scoped token when the gate allows", async (call) => {
    const reached: string[] = []
    const server = makeServer(reached, () => "allow")

    const response = await send(server, call, await issueToken(server, READ_ONLY_CAPABILITIES))

    expect(response.status).toBe(200)
    expect(reached).toEqual([call.surface])
  })

  it.each(READ_CALLS)("$name refuses and never reaches the surface when the gate denies", async (call) => {
    const reached: string[] = []
    const server = makeServer(reached, () => "deny")

    const response = await send(server, call, await issueToken(server, READ_ONLY_CAPABILITIES))

    expect(response.status).toBe(403)
    expect(reached).toEqual([])
  })

  it.each(WRITE_CALLS)("$name fails closed for a read-only token even when the gate would allow", async (call) => {
    const reached: string[] = []
    const server = makeServer(reached, () => "allow")

    const response = await send(server, call, await issueToken(server, READ_ONLY_CAPABILITIES))

    expect(response.status).toBe(403)
    expect(reached).toEqual([])
  })

  it.each(WRITE_CALLS)("$name reaches the surface for a write-scoped token the gate allows", async (call) => {
    const reached: string[] = []
    const server = makeServer(reached, () => "allow")

    const response = await send(server, call, await issueToken(server, WRITE_CAPABILITIES))

    expect(response.status).toBeLessThan(300)
    expect(reached).toEqual([call.surface])
  })

  it.each(WRITE_CALLS)("$name never reaches the surface when the gate denies a write-scoped token", async (call) => {
    const reached: string[] = []
    const server = makeServer(reached, () => "deny")

    const response = await send(server, call, await issueToken(server, WRITE_CAPABILITIES))

    expect(response.status).toBe(403)
    expect(reached).toEqual([])
  })
})
