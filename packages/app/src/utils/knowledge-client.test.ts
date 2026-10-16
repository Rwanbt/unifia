/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { createKnowledgeClient, KnowledgeRequestError } from "./knowledge-client"

const SERVER = { url: "http://127.0.0.1:4096", username: "unifia", password: "owner-password" }
const BASIC = `Basic ${btoa("unifia:owner-password")}`

function recordingFetch(status = 200, body: unknown = { vault: "present", notes: [] }) {
  const calls: Array<{ url: URL; headers: Record<string, string> }> = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as typeof globalThis.fetch
  return { fetch: fetchFn, calls }
}

describe("createKnowledgeClient: the same transport as the SDK", () => {
  test("sends the project directory and the connection's Basic credentials, to the server's own URL", async () => {
    const recorder = recordingFetch()
    const client = createKnowledgeClient({ server: SERVER, fetch: recorder.fetch, directory: "/work/project" })
    await client.tree()
    const [call] = recorder.calls
    expect(call!.url.origin).toBe("http://127.0.0.1:4096")
    expect(call!.url.pathname).toBe("/knowledge/tree")
    expect(call!.url.searchParams.get("directory")).toBe("/work/project")
    expect(call!.headers.Authorization).toBe(BASIC)
  })

  test("an explicit Bearer session takes precedence over the Basic credentials, as in the SDK", async () => {
    const recorder = recordingFetch()
    const client = createKnowledgeClient({
      server: SERVER,
      fetch: recorder.fetch,
      directory: "/work/project",
      headers: { Authorization: "Bearer session-token" },
    })
    await client.status()
    expect(recorder.calls[0]!.headers.Authorization).toBe("Bearer session-token")
  })

  test("no credentials are sent when the connection has none", async () => {
    const recorder = recordingFetch()
    const client = createKnowledgeClient({
      server: { url: "http://127.0.0.1:4096" },
      fetch: recorder.fetch,
      directory: "/work/project",
    })
    await client.status()
    expect(recorder.calls[0]!.headers.Authorization).toBeUndefined()
  })
})

describe("createKnowledgeClient: names are values, never path", () => {
  test("a note id is encoded in the path, so a hostile id stays inside the notes routes", async () => {
    const recorder = recordingFetch()
    const client = createKnowledgeClient({ server: SERVER, fetch: recorder.fetch, directory: "/work/project" })
    await client.backlinks("x/../../tree")
    expect(recorder.calls[0]!.url.origin).toBe("http://127.0.0.1:4096")
    expect(recorder.calls[0]!.url.pathname.startsWith("/knowledge/notes/")).toBe(true)
  })

  test("search passes the limit only when one is given", async () => {
    const recorder = recordingFetch()
    const client = createKnowledgeClient({ server: SERVER, fetch: recorder.fetch, directory: "/work/project" })
    await client.search("alpha")
    await client.search("alpha", 5)
    expect(recorder.calls[0]!.url.searchParams.has("limit")).toBe(false)
    expect(recorder.calls[1]!.url.searchParams.get("limit")).toBe("5")
  })
})

describe("createKnowledgeClient: refusals reach the caller with their status", () => {
  test("a non-OK answer throws a KnowledgeRequestError carrying the status and the server's body", async () => {
    const recorder = recordingFetch(403, { error: "owner authority required" })
    const client = createKnowledgeClient({ server: SERVER, fetch: recorder.fetch, directory: "/work/project" })
    const error = await client.tree().then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(KnowledgeRequestError)
    expect((error as KnowledgeRequestError).status).toBe(403)
    expect((error as KnowledgeRequestError).body).toEqual({ error: "owner authority required" })
  })
})

describe("createKnowledgeClient: the transport is called without a receiver", () => {
  test("a fetch that refuses any receiver but the global object still answers", async () => {
    const recorder = recordingFetch()
    // WHY: the browser's fetch throws "Illegal invocation" when it is called as a method of another object. This fetch
    // reproduces that refusal, so the test fails on the defect itself rather than only in a browser.
    const nativeLike = function (this: unknown, input: string | URL | Request, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation")
      return recorder.fetch(input, init)
    } as typeof globalThis.fetch
    const client = createKnowledgeClient({ server: SERVER, fetch: nativeLike, directory: "/work/project" })
    await expect(client.tree()).resolves.toEqual({ vault: "present", notes: [] })
    expect(recorder.calls).toHaveLength(1)
  })
})
