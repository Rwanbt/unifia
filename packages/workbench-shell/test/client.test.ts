/* SPDX-License-Identifier: MIT */

import { WorkbenchClient, WorkbenchEventDispatcher, WorkbenchHttpError, newRequestId } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}

let token = "expired"
let refreshes = 0
const requests: Array<{ url: string }> = []
const client = new WorkbenchClient({
  baseUrl: "http://127.0.0.1:7444",
  instanceId: "instance-1",
  token: {
    current: () => token,
    refresh: async () => { refreshes += 1; token = "fresh"; return token },
  },
  fetchImpl: async (input, init) => {
    requests.push({ url: new URL(String(input)).pathname + new URL(String(input)).search })
    if (init?.headers && token === "expired") return new Response(null, { status: 401 })
    const path = new URL(String(input)).pathname
    const payload = path === "/v1/trace" ? { kind: "trace", events: [], nextCursor: null } : path === "/v1/activity" ? { kind: "activity", events: [], nextCursor: null } : { ok: true, entries: [] }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
  },
})

const listRequest = await client.listFiles("workspace-1", "src")
check(requests.at(-1)?.url === "/v1/files/list?workspaceId=workspace-1&prefix=src", "file list client route was not encoded deterministically")
check(listRequest.entries.length === 0, "file list client did not decode the response")
const searchRequest = await client.searchFiles("workspace-1", "main.ts")
check(requests.at(-1)?.url === "/v1/files/search?workspaceId=workspace-1&query=main.ts&prefix=.", "file search client route was not encoded deterministically")
check(searchRequest.entries.length === 0, "file search client did not decode the response")
await client.listArtifacts("workspace-1")
check(requests.at(-1)?.url === "/v1/artifacts?workspaceId=workspace-1", "artifact list client route was not encoded deterministically")
await client.listDocuments("workspace-1")
check(requests.at(-1)?.url === "/v1/documents?workspaceId=workspace-1", "document list client route was not encoded deterministically")
const trace = await client.trace("workspace-1", 4, 2)
check(requests.at(-1)?.url === "/v1/trace?workspaceId=workspace-1&after=4&limit=2", "trace client route was not encoded deterministically")
check(trace.kind === "trace" && trace.events.length === 0, "trace client did not decode the typed page")
const activity = await client.activity("workspace-1")
check(requests.at(-1)?.url === "/v1/activity?workspaceId=workspace-1&after=0&limit=50", "activity client route did not apply bounded defaults")
check(activity.kind === "activity", "activity client did not preserve the page kind")

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
