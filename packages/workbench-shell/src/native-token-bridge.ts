/* SPDX-License-Identifier: MIT */

import type { TokenProvider } from "./client.js"

export type NativeTokenRequest = { workspaceId: string; capabilities: readonly string[] }
export type NativeIssuedToken = { token: string; instanceId: string; workspaceId: string; expiresAt: number }
export type NativeTokenBridge = {
  issue(request: NativeTokenRequest): Promise<NativeIssuedToken>
  rotate(request: NativeTokenRequest): Promise<unknown>
  revoke(workspaceId: string): Promise<void>
}

function assertIssuedToken(value: NativeIssuedToken): NativeIssuedToken {
  if (!value || typeof value.token !== "string" || value.token.length === 0) throw new Error("native bridge returned an invalid token")
  if (typeof value.instanceId !== "string" || value.instanceId.length === 0) throw new Error("native bridge returned an invalid instance id")
  if (typeof value.workspaceId !== "string" || value.workspaceId.length === 0) throw new Error("native bridge returned an invalid workspace id")
  if (!Number.isSafeInteger(value.expiresAt)) throw new Error("native bridge returned an invalid token expiry")
  return value
}

/** Adapts the native bridge without exposing signing material to the WebView. */
export async function createNativeTokenProvider(bridge: NativeTokenBridge, request: NativeTokenRequest): Promise<{ provider: TokenProvider; revoke(): Promise<void> }> {
  let issued = assertIssuedToken(await bridge.issue(request))
  const provider: TokenProvider = {
    current: () => issued.token,
    refresh: async () => {
      const rotation = await bridge.rotate(request)
      if (!rotation || typeof rotation !== "object" || typeof (rotation as { token?: unknown }).token !== "string") throw new Error("native bridge returned an invalid rotation")
      issued = { ...issued, token: (rotation as { token: string }).token }
      return issued.token
    },
    applyRotation: (rotation) => { issued = { ...issued, token: rotation.token } },
  }
  return { provider, revoke: () => bridge.revoke(request.workspaceId) }
}
