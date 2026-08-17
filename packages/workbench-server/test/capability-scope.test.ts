/* SPDX-License-Identifier: MIT */

// C1-3/SEC-001: a token issued with only ["workspace.read", "workspace.watch"]
// must be refused (403, no approval created) on every mutating route.
// #checkCapability(capability, resource) only ever calls
// this.#capability.check(capability, resource, "workbench-server") — it
// never receives or consults the calling principal's token-scoped
// capabilities (built once, at #authenticate, into principal.scopes, and
// never read again). This test proves that by using a capability gate that
// always returns approval_required regardless of which capability is asked
// for: if the token's own scopes mattered, a read/watch-only token would
// never reach this gate for a write-class capability in the first place.

import { describe, expect, it } from "vitest"
import { ScopedTokenIssuer, WorkbenchServer } from "../src/index.js"

const WORKSPACE_ID = "ws-1"
const READ_ONLY_CAPABILITIES = ["workspace.read", "workspace.watch"]

type Route = { name: string; path: string; body: Record<string, unknown> }

const MUTATING_ROUTES: readonly Route[] = [
  { name: "files.write", path: "/v1/files/write", body: { workspaceId: WORKSPACE_ID, writes: [{ path: "a.txt", content: "x" }] } },
  { name: "artifacts.create", path: "/v1/artifacts", body: { workspaceId: WORKSPACE_ID, kind: "text", filename: "a.txt", content: "" } },
  { name: "artifacts.export", path: "/v1/artifacts/export", body: { workspaceId: WORKSPACE_ID, artifactId: "artifact-1" } },
  { name: "workflows.start", path: "/v1/workflows/start", body: { workspaceId: WORKSPACE_ID, definition: { id: "wf-1", version: 1, steps: [] } } },
  { name: "desktop.control", path: "/v1/desktop/control", body: { workspaceId: WORKSPACE_ID, appId: "app-1", action: "keyboard", payload: {} } },
  { name: "capabilities.register", path: "/v1/capabilities/register", body: { workspaceId: WORKSPACE_ID, manifest: { descriptor: { id: "x", name: "x", description: "x", version: "1.0.0", author: "x", license: "MIT", schema: {}, tags: [], trustLevel: "untrusted" }, digest: "sha256:x", signature: "x", sourceRepo: "local", sourceCommit: "abc", license: "MIT", remoteCode: false } } },
]

async function issueReadOnlyToken(server: WorkbenchServer) {
  const issued = await server.issueNativeScopedToken({ principalId: "principal-1", workspaceId: WORKSPACE_ID, capabilities: READ_ONLY_CAPABILITIES })
  return issued.token
}

describe("SEC-001: capability scope of the token, not just the server-wide gate (C1-3)", () => {
  it.each(MUTATING_ROUTES)("$name refuses a read/watch-only token with 403 and creates no approval", async ({ path, body }) => {
    let approvalsCreated = 0
    const server = new WorkbenchServer({
      auth: { authenticate: async () => undefined },
      tokenIssuer: new ScopedTokenIssuer("x".repeat(32), 60_000, 30_000),
      workspace: { open: async (id: string) => ({ id, token: `runtime-${id}` }) } as never,
      runtime: {} as never,
      artifacts: {} as never,
      workflow: {} as never,
      desktop: {} as never,
      capabilities: {} as never,
      audit: { record: () => undefined },
      capability: {
        check: async (capability) => {
          approvalsCreated += 1
          return { kind: "approval_required", approvalId: `approval-${capability}` }
        },
      },
    })
    const token = await issueReadOnlyToken(server)

    const response = await server.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }))

    expect(response.status).toBe(403)
    expect(approvalsCreated).toBe(0)
  })
})
