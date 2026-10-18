/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { ScopedTokenIssuer } from "../src/auth.js"
import { AuditRuntimeDouble, FakeRuntimeAdapter } from "@unifia/contracts"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { WorkbenchServer } from "../src/server.js"

describe("scoped native token issuer", () => {
  test("issues a token bound to workspace and instance", () => {
    let now = 1_000
    const issuer = new ScopedTokenIssuer("x".repeat(32), 100, 30, () => now)
    const issued = issuer.issue({ principalId: "user", workspaceId: "workspace", instanceId: "instance", capabilities: ["workspace.read"] })
    expect(issuer.verify(issued.token)?.workspaceId).toBe("workspace")
    expect(issuer.verify(issued.token)?.instanceId).toBe("instance")
    expect(issuer.verify(issued.token)?.capabilities).toEqual(["workspace.read"])
    now = 1_100
    expect(issuer.verify(issued.token)).toBeUndefined()
  })

  test("accepts the previous token only during rotation grace", () => {
    let now = 1_000
    const issuer = new ScopedTokenIssuer("x".repeat(32), 1_000, 30, () => now)
    const first = issuer.issue({ principalId: "user", workspaceId: "workspace", instanceId: "instance", capabilities: [] })
    const rotated = issuer.rotate({ principalId: "user", workspaceId: "workspace", instanceId: "instance", capabilities: ["workspace.read"] })
    expect(rotated.previousToken).toBe(first.token)
    expect(issuer.verify(first.token)?.tokenId).toBe(first.tokenId)
    now += 31
    expect(issuer.verify(first.token)).toBeUndefined()
    expect(issuer.verify(rotated.token.token)).toBeDefined()
  })

  test("revokes current and previous tokens when a scope closes", () => {
    const issuer = new ScopedTokenIssuer("x".repeat(32), 1_000, 30)
    const request = { principalId: "user", workspaceId: "workspace", instanceId: "instance", capabilities: [] as const }
    const first = issuer.issue(request)
    const rotated = issuer.rotate(request)
    issuer.revoke(request)
    expect(issuer.verify(first.token)).toBeUndefined()
    expect(issuer.verify(rotated.token.token)).toBeUndefined()
  })
})

function pendingRegistration(now: () => number = Date.now) {
  let resume!: () => void
  const waiting = new Promise<void>((resolve) => { resume = resolve })
  const closed: string[] = []
  class Workspace extends WorkspaceRuntime {
    override async open(id: string) {
      await waiting
      return { id, token: "pending-runtime-session" }
    }
    override async close(token: string) { closed.push(token) }
  }
  const server = new WorkbenchServer({
    auth: { authenticate: async () => undefined },
    workspace: new Workspace(),
    runtime: new FakeRuntimeAdapter(),
    audit: new AuditRuntimeDouble(),
    capability: { check: async () => "allow" },
    tokenIssuer: new ScopedTokenIssuer("x".repeat(32), 1_000, 30, now),
  })
  const request = { principalId: "user", workspaceId: "workspace", capabilities: ["workspace.read"] }
  const registration = server.issueNativeScopedToken(request).then(
    (token) => ({ token, error: undefined }),
    (error: unknown) => ({ token: undefined, error }),
  )
  return { server, resume, closed, registration }
}

describe("native token registration across asynchronous workspace open", () => {
  test("NativeToken_RevokeDuringOpen_RejectsAndClosesLateSession", async () => {
    const pending = pendingRegistration()
    await pending.server.revokeNativeScopedToken("workspace")
    pending.resume()
    const result = await pending.registration
    expect(result.error).toBeInstanceOf(Error)
    expect(result.token).toBeUndefined()
    expect(pending.closed).toEqual(["pending-runtime-session"])
    expect(pending.server.openFileSessions).toBe(0)
  })

  test("NativeToken_ExpiresDuringOpen_RejectsAndClosesLateSession", async () => {
    let now = 1_000
    const pending = pendingRegistration(() => now)
    now = 2_000
    pending.resume()
    const result = await pending.registration
    expect(result.error).toBeInstanceOf(Error)
    expect(result.token).toBeUndefined()
    expect(pending.closed).toEqual(["pending-runtime-session"])
    expect(pending.server.openFileSessions).toBe(0)
  })

  test("NativeToken_ValidAfterOpen_RegistersAndRevokesNormally", async () => {
    const pending = pendingRegistration()
    pending.resume()
    const result = await pending.registration
    expect(result.error).toBeUndefined()
    expect(result.token).toBeDefined()
    expect(pending.server.openFileSessions).toBe(1)
    expect(pending.closed).toEqual([])
    await pending.server.revokeNativeScopedToken("workspace")
    expect(pending.closed).toEqual(["pending-runtime-session"])
    expect(pending.server.openFileSessions).toBe(0)
  })
})
