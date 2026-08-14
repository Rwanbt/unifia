/* SPDX-License-Identifier: MIT */
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createWorkbenchBridge } from "../../src/server/workbench"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-workbench-bridge-"))
const previousPassword = process.env.UNIFIA_SERVER_PASSWORD
const previousToken = process.env.UNIFIA_KEYCHAIN_TOKEN
process.env.UNIFIA_SERVER_PASSWORD = "unifia-workbench-bridge-password-0123456789"
process.env.UNIFIA_KEYCHAIN_TOKEN = "private-ipc-token"

try {
  const bridge = createWorkbenchBridge()
  if (!bridge) throw new Error("private Workbench bridge did not initialize")
  const workspacePath = path.join(root, "workspace")
  await mkdir(workspacePath)
  const nativeHeaders = { "x-unifia-keychain-token": "private-ipc-token", "content-type": "application/json" }

  const opened = await bridge.native(new Request("http://127.0.0.1/workbench/native/token", {
    method: "POST", headers: nativeHeaders,
    body: JSON.stringify({ action: "open", workspacePath }),
  }))
  if (opened.status !== 200) throw new Error(`native workspace open failed: ${opened.status}`)
  const workspace = await opened.json() as { workspaceId?: string; instanceId?: string }
  if (!workspace.workspaceId || !workspace.instanceId) throw new Error("native open did not return opaque workspace metadata")

  const issued = await bridge.native(new Request("http://127.0.0.1/workbench/native/token", {
    method: "POST", headers: nativeHeaders,
    body: JSON.stringify({ action: "issue", workspaceId: workspace.workspaceId, capabilities: ["workspace.read"] }),
  }))
  if (issued.status !== 200) throw new Error(`native token issue failed: ${issued.status}`)
  const lease = await issued.json() as { token?: string; instanceId?: string; workspaceId?: string }
  if (!lease.token || lease.instanceId !== workspace.instanceId || lease.workspaceId !== workspace.workspaceId) throw new Error("native lease metadata was not bound to the opened workspace")

  const listed = await bridge.fetch(new Request(`http://127.0.0.1/workbench/v1/files/list?workspaceId=${encodeURIComponent(workspace.workspaceId)}`, {
    headers: { "x-unifia-file-session": lease.token },
  }))
  if (listed.status !== 200) throw new Error(`native lease was not accepted by the mounted Workbench route: ${listed.status} ${await listed.text()}`)

  const denied = await bridge.native(new Request("http://127.0.0.1/workbench/native/token", {
    method: "POST", headers: { ...nativeHeaders, "x-unifia-keychain-token": "wrong" },
    body: JSON.stringify({ action: "issue", workspaceId: workspace.workspaceId }),
  }))
  if (denied.status !== 401) throw new Error(`invalid native IPC token was accepted: ${denied.status}`)
  await bridge.app.server.shutdown()
  console.log("WorkbenchNativeBridge: 4/4 passed")
} finally {
  if (previousPassword === undefined) delete process.env.UNIFIA_SERVER_PASSWORD
  else process.env.UNIFIA_SERVER_PASSWORD = previousPassword
  if (previousToken === undefined) delete process.env.UNIFIA_KEYCHAIN_TOKEN
  else process.env.UNIFIA_KEYCHAIN_TOKEN = previousToken
  await rm(root, { recursive: true, force: true })
}
