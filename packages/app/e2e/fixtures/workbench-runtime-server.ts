/* SPDX-License-Identifier: MIT */

import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { P3_CAPABILITIES } from "@unifia/contracts"
import { NativeWorkflowRuntimePort } from "@unifia/workbench-server"
import { createWorkbenchApp, type WorkbenchConfig } from "@unifia/workbench-server/bootstrap"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-cr04-workflow-"))
const workspaceRoot = path.join(root, "workspace")
await mkdir(workspaceRoot, { recursive: true })
await mkdir(path.join(root, "artifacts"), { recursive: true })
const runtime = new NativeWorkflowRuntimePort({ databasePath: path.join(root, "workflows.sqlite") })
const config: WorkbenchConfig = {
  signingKey: "unifia-cr04-browser-runtime-test-signing-key",
  issuer: "unifia-cr04-browser-runtime-test",
  audience: "workbench",
  host: "127.0.0.1",
  port: 0,
  runtime: "fake",
  auditLogPath: path.join(root, "audit.jsonl"),
  rateBudget: 240,
  rateWindowMs: 60_000,
  allowlistedCapabilities: new Set(P3_CAPABILITIES),
  artifactRoot: path.join(root, "artifacts"),
  presentLinkTtlMs: 60_000,
  allowedOrigins: ["http://127.0.0.1:*", "http://localhost:*"],
}
const app = createWorkbenchApp(config, { workflow: runtime })
const workspace = await app.workspace.register({ name: "cr04-browser-e2e", path: workspaceRoot })
const workspaceId = workspace.id
const listener = Bun.serve({
  hostname: config.host,
  port: config.port,
  idleTimeout: 0,
  fetch: (request) => app.server.fetch(request),
})
if (typeof listener.port !== "number") throw new Error("Workbench listener did not expose its port")

const lease = await app.server.issueNativeScopedToken({
  principalId: "cr04-browser-e2e",
  workspaceId,
  capabilities: ["workflow.run", "workspace.read"],
})
process.stdout.write(`${JSON.stringify({
  baseUrl: `http://${config.host}:${listener.port}`,
  workspaceId,
  token: lease.token,
})}\n`)

let stopped = false
async function stop(): Promise<void> {
  if (stopped) return
  stopped = true
  listener.stop(true)
  runtime.close()
  await app.server.shutdown()
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

process.once("SIGINT", () => void stop())
process.once("SIGTERM", () => void stop())
