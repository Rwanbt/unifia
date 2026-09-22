/* SPDX-License-Identifier: MIT */

// ADR-041 — the web runtime's Workbench bridge. The desktop gets its lease
// through a Tauri command guarded by the keychain IPC bearer, which never
// enters a WebView; the browser instead calls POST /workbench-web/token with
// the credentials it already uses for the server API. Minting stays in the
// sidecar: this module only ever handles the scoped lease it hands back.

import { connectWorkbench, type NativeIssuedToken, type NativeTokenRotation, type WorkbenchConnection } from "@unifia/workbench-shell"
import type { Platform } from "@/context/platform"

export const WEB_BRIDGE_ROUTE = "/workbench-web/token"

export type WebWorkbenchServer = {
  /** Base URL of the sidecar the app currently talks to. */
  readonly url: string
  /** Same Authorization header the SDK sends (Bearer wins over Basic). */
  readonly authorization?: string
}

/** Thrown when the sidecar has no web bridge (no server password, ADR-041). */
export class WebWorkbenchBridgeUnavailableError extends Error {
  constructor() {
    super("Workbench web bridge unavailable: the server has no password configured")
    this.name = "WebWorkbenchBridgeUnavailableError"
  }
}

async function call<T>(server: WebWorkbenchServer, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${server.url.replace(/\/+$/, "")}${WEB_BRIDGE_ROUTE}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(server.authorization ? { Authorization: server.authorization } : {}),
    },
    body: JSON.stringify(body),
  })
  if (response.status === 404) throw new WebWorkbenchBridgeUnavailableError()
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Workbench web bridge ${String(body.action)} failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  return (await response.json()) as T
}

export function createWebWorkbenchBridge(server: () => WebWorkbenchServer): NonNullable<Platform["workbench"]> {
  return {
    async connect(input): Promise<WorkbenchConnection> {
      const target = server()
      const workspace = await call<{ workspaceId: string; instanceId: string }>(target, {
        action: "open",
        workspacePath: input.workspacePath,
      })
      return connectWorkbench({
        baseUrl: `${target.url.replace(/\/+$/, "")}/workbench`,
        bridge: {
          issue: (request) =>
            call<NativeIssuedToken>(target, { action: "issue", workspaceId: request.workspaceId, capabilities: [...request.capabilities] }),
          rotate: (request) =>
            call<NativeTokenRotation>(target, { action: "rotate", workspaceId: request.workspaceId, capabilities: [...request.capabilities] }),
          revoke: async (workspaceId) => {
            await call(target, { action: "revoke", workspaceId })
          },
        },
        tokenRequest: { workspaceId: workspace.workspaceId, capabilities: [...input.capabilities] },
      })
    },
  }
}
