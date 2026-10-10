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
  test("a note locator is sent as a query value, so a locator cannot change the route", async () => {
    const recorder = recordingFetch()
    const client = createKnowledgeClient({ server: SERVER, fetch: recorder.fetch, directory: "/work/project" })
    await client.note("../../etc/passwd.md")
    const url = recorder.calls[0]!.url
    expect(url.pathname).toBe("/knowledge/note")
    expect(url.searchParams.get("locator")).toBe("../../etc/passwd.md")
  })

  test("a note id is encoded in the path, so a hostile id stays inside the notes routes", async () => {
    const recorder = recordingFetch()
    const client = createKnowledgeClient({ server: SERVER, fetch: recorder.fetch, directory: "/work/project" })
    await client.backlinks("x/../../tree")
    await client.links("a?b=c#d")
    expect(recorder.calls[0]!.url.origin).toBe("http://127.0.0.1:4096")
    expect(recorder.calls[0]!.url.pathname.startsWith("/knowledge/notes/")).toBe(true)
    expect(recorder.calls[1]!.url.pathname).toBe("/knowledge/notes/a%3Fb%3Dc%23d/links")
    expect(recorder.calls[1]!.url.searchParams.has("b")).toBe(false)
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

  test("a 404 for a note is a refusal, never an empty success", async () => {
    const recorder = recordingFetch(404, { error: "note not found" })
    const client = createKnowledgeClient({ server: SERVER, fetch: recorder.fetch, directory: "/work/project" })
    await expect(client.note("missing.md")).rejects.toMatchObject({ status: 404 })
  })
})
