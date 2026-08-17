/* SPDX-License-Identifier: MIT */

import { chromium } from "playwright"
import { test } from "bun:test"
import { WIRE_PROTOCOL_VERSION, WORKBENCH_REQUEST_HEADERS } from "@unifia/contracts/workbench-wire"
import { WorkbenchClient } from "@unifia/workbench-shell"
import { createWorkbenchApp, type WorkbenchConfig } from "../src/bootstrap.js"

const signingKey = "workbench-real-transport-test-signing-key-0123456789"

test("real Workbench transport exercises client, loopback HTTP, and browser CORS", async () => {
  const config: WorkbenchConfig = {
    signingKey,
    issuer: "unifia-real-transport-test",
    audience: "workbench",
    host: "127.0.0.1",
    port: 0,
    runtime: "fake",
    auditLogPath: `${process.cwd()}/.unifia/real-transport-audit.jsonl`,
    rateBudget: 240,
    rateWindowMs: 60_000,
    allowlistedCapabilities: new Set(),
  }
  const app = createWorkbenchApp(config)
  const listener = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 0,
    fetch: (request) => app.server.fetch(request),
  })
  const port = listener.port
  if (typeof port !== "number") throw new Error("real transport listener did not expose an automatic port")
  const baseUrl = `http://${config.host}:${port}`
  const workspaceId = "real-transport-workspace"
  const lease = app.tokenIssuer.issue({
    principalId: "playwright-test",
    workspaceId,
    instanceId: app.server.instanceId,
    capabilities: ["workspace.read", "workspace.watch"],
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
  const client = new WorkbenchClient({
    baseUrl,
    instanceId: lease.instanceId,
    token: {
      current: () => lease.token,
      refresh: async () => lease.token,
    },
  })
  const handshake = await client.handshake()
  if (!handshake.accepted || handshake.instanceId !== app.server.instanceId) {
    throw new Error("production WorkbenchClient did not complete the real loopback handshake")
  }

  browser = await chromium.launch({ headless: true, timeout: 15_000 })
  const page = await browser.newPage()
  const preflights: Array<{ method: string; url: string; headers: Record<string, string> }> = []
  page.on("request", (request) => {
    if (request.url() === `${baseUrl}/v1/handshake` && request.method() === "OPTIONS") {
      preflights.push({ method: request.method(), url: request.url(), headers: request.headers() })
    }
  })
  await page.route("http://tauri.localhost/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Unifia transport harness</title>" }))
  await page.goto("http://tauri.localhost/", { waitUntil: "domcontentloaded", timeout: 10_000 })
  const browserResponse = await page.evaluate(async ({ baseUrl: target, workspaceId: targetWorkspace, token, instanceId, protocolVersion }) => {
    const response = await fetch(`${target}/v1/handshake`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-unifia-instance-id": instanceId,
        "x-unifia-client-time": String(Date.now()),
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        kind: "workbench.handshake",
        protocolVersion,
        supportedVersions: [protocolVersion],
        clientInstanceId: "browser-client",
        workspaceId: targetWorkspace,
      }),
    })
    return { status: response.status, allowOrigin: response.headers.get("access-control-allow-origin") }
  }, { baseUrl, workspaceId, token: lease.token, instanceId: lease.instanceId, protocolVersion: WIRE_PROTOCOL_VERSION })

  if (browserResponse.status !== 200 || browserResponse.allowOrigin !== "http://tauri.localhost") {
    throw new Error(`browser handshake failed: status=${browserResponse.status} origin=${browserResponse.allowOrigin}`)
  }
  if (preflights.length !== 1) throw new Error(`expected one real browser preflight, observed ${preflights.length}`)
  const preflight = preflights[0]
  if (preflight.headers.origin !== "http://tauri.localhost") throw new Error("browser preflight did not carry the supported Tauri origin")
  const requestedHeaders = preflight.headers["access-control-request-headers"]?.split(",").map((header) => header.trim()) ?? []
  const missing = requestedHeaders.filter((header) => !WORKBENCH_REQUEST_HEADERS.includes(header as (typeof WORKBENCH_REQUEST_HEADERS)[number]))
  if (missing.length > 0) throw new Error(`real CORS preflight omitted client headers: ${missing.join(",")}`)

  } finally {
    await browser?.close()
    await app.server.shutdown()
    await listener.stop(true)
  }
})
