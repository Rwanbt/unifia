/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { WorkbenchClient } from "../src/client.js"

test("WorkbenchClient_BrowserObserveAndAct_UsesSessionScopedRoutes", async () => {
  const requests: { url: string; init?: RequestInit }[] = []
  const client = new WorkbenchClient({
    baseUrl: "http://127.0.0.1:4101",
    instanceId: "instance",
    token: { current: () => "browser-token", refresh: async () => "browser-token" },
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init })
      return Response.json(requests.length === 1 ? { receipt: { id: "receipt" }, modelText: "page" } : { accepted: true })
    },
  })

  await client.observeBrowserTab("workspace", "session", "tab")
  await client.actOnBrowserTab("workspace", "session", "tab", "receipt", { kind: "click", selector: "button" })

  expect(new URL(requests[0]!.url).pathname).toBe("/v1/browser/sessions/session/tabs/tab/observe")
  expect(JSON.parse(String(requests[1]!.init?.body))).toMatchObject({ workspaceId: "workspace", observationId: "receipt", action: { kind: "click", selector: "button" } })
  expect(requests.every((request) => request.init?.headers && "authorization" in request.init.headers)).toBe(true)
})

test("WorkbenchClient_BrowserViewportResize_UsesSessionControlRoute", async () => {
  let request: { url: string; init?: RequestInit } | undefined
  const client = new WorkbenchClient({
    baseUrl: "http://127.0.0.1:4101",
    instanceId: "instance",
    token: { current: () => "browser-token", refresh: async () => "browser-token" },
    fetchImpl: async (input, init) => {
      request = { url: String(input), init }
      return Response.json({ session: { id: "session", viewport: { width: 820, height: 1180 } } })
    },
  })

  await client.resizeBrowserViewport("workspace", "session", { width: 820, height: 1180 })

  expect(new URL(request!.url).pathname).toBe("/v1/browser/sessions/session/viewport")
  expect(request!.init?.method).toBe("POST")
  expect(JSON.parse(String(request!.init?.body))).toMatchObject({ workspaceId: "workspace", viewport: { width: 820, height: 1180 } })
})
