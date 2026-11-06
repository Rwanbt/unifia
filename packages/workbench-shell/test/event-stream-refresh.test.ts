/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"
import { WorkbenchClient, WorkbenchEventDispatcher } from "../src/index.js"

// The app's event consumer treats a 401 as final and stops listening for good,
// so a lease that expired just before the stream opened used to silence every
// live update of the workspace until a reload.
test("EventStream_ExpiredLease_RefreshesOnceAndOpens", async () => {
  let token = "expired"
  let refreshes = 0
  const seen: string[] = []
  const client = new WorkbenchClient({
    baseUrl: "http://127.0.0.1:7444",
    instanceId: "instance-1",
    token: {
      current: () => token,
      refresh: async () => {
        refreshes += 1
        token = "fresh"
        return token
      },
    },
    fetchImpl: async (_input, init) => {
      const authorization = new Headers(init?.headers).get("authorization") ?? ""
      seen.push(authorization)
      if (authorization !== "Bearer fresh") return new Response(null, { status: 401 })
      return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })
    },
  })

  const events = []
  for await (const event of client.events("workspace-1", new WorkbenchEventDispatcher())) events.push(event)

  expect(events).toEqual([])
  expect(refreshes).toBe(1)
  expect(seen).toEqual(["Bearer expired", "Bearer fresh"])
})
