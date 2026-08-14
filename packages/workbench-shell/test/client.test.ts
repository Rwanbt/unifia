/* SPDX-License-Identifier: MIT */

import { WorkbenchClient, WorkbenchEventDispatcher, WorkbenchHttpError, newRequestId } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}

let token = "expired"
let refreshes = 0
const client = new WorkbenchClient({
  baseUrl: "http://127.0.0.1:7444",
  instanceId: "instance-1",
  token: {
    current: () => token,
    refresh: async () => { refreshes += 1; token = "fresh"; return token },
  },
  fetchImpl: async (_input, init) => {
    if (init?.headers && token === "expired") return new Response(null, { status: 401 })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
  },
})

check((await client.request<{ ok: boolean }>("/v1/read")).ok, "a GET did not retry after token refresh")
check(refreshes === 1, "GET refresh count was not exactly one")

let postCalls = 0
const mutant = new WorkbenchClient({
  baseUrl: "http://127.0.0.1:7444",
  instanceId: "instance-1",
  token: { current: () => "expired", refresh: async () => "fresh" },
  fetchImpl: async () => { postCalls += 1; return new Response(null, { status: 401 }) },
})
try { await mutant.request("/v1/write", { method: "POST", body: { value: 1 } }) } catch (error) { check(error instanceof WorkbenchHttpError && error.status === 401, "mutant POST returned the wrong error") }
check(postCalls === 1, "mutant POST was replayed without idempotency")

const dispatcher = new WorkbenchEventDispatcher()
dispatcher.apply({ eventId: "1", workspaceId: "ws", sequenceId: 1, cursor: "c1", type: "operation.updated", payload: { state: "running" } })
dispatcher.apply({ eventId: "2", workspaceId: "ws", sequenceId: 3, cursor: "c3", type: "operation.updated", payload: { state: "done" } })
check(dispatcher.lastSequence === 3 && dispatcher.resyncRequired, "sequence gap did not request resync")
check(dispatcher.events.filter((event) => event.type === "operation.updated").length === 1, "last-wins event was not merged")
check(newRequestId().includes("-7"), "idempotency key was not UUID v7")

console.log(`WorkbenchClient: ${checks}/${checks} passed`)
