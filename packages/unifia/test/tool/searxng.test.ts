/* SPDX-License-Identifier: MIT */

// ADR-044 — the websearch tool's SearXNG client, against a local fake instance.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { SearXNG } from "../../src/tool/searxng"

let server: ReturnType<typeof Bun.serve>
let base = ""
let lastQuery: URLSearchParams | undefined

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/json-off/search") return new Response("Forbidden", { status: 403 })
      lastQuery = url.searchParams
      return Response.json({
        query: url.searchParams.get("q"),
        results: [
          { url: "https://bun.sh/blog/bun-v1.3", title: "Bun v1.3", content: "Bun 1.3 is out.", publishedDate: "2026-01-02" },
          { title: "no url, skipped" },
          { url: "https://github.com/oven-sh/bun/releases", title: "Releases" },
        ],
      })
    },
  })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(() => server.stop(true))

describe("SearXNG", () => {
  test("url: environment first, then config, trailing slash removed, none when unset", () => {
    expect(SearXNG.url({ websearch: { searxng_url: "http://cfg:8888/" } }, {})).toBe("http://cfg:8888")
    expect(SearXNG.url({ websearch: { searxng_url: "http://cfg:8888" } }, { UNIFIA_SEARXNG_URL: "http://env:1" })).toBe(
      "http://env:1",
    )
    expect(SearXNG.url({}, {})).toBeUndefined()
    expect(SearXNG.url({}, { UNIFIA_SEARXNG_URL: "  " })).toBeUndefined()
  })

  test("search asks the instance for JSON and keeps only results with a URL", async () => {
    const results = await SearXNG.search(base, "bun latest version", 8)
    expect(lastQuery?.get("q")).toBe("bun latest version")
    expect(lastQuery?.get("format")).toBe("json")
    expect(results.map((r) => r.url)).toEqual(["https://bun.sh/blog/bun-v1.3", "https://github.com/oven-sh/bun/releases"])
    expect(await SearXNG.search(base, "x", 1)).toHaveLength(1)
  })

  test("a 403 explains that the json format must be enabled", async () => {
    await expect(SearXNG.search(`${base}/json-off`, "x", 8)).rejects.toThrow("search.formats")
  })

  test("probe: reachable instance, unreachable one, answers cached for 30 s", async () => {
    let now = 0
    let calls = 0
    const counting: typeof fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls++
      return fetch(input, init)
    }) as typeof fetch
    const reachable = SearXNG.createProbe({ fetch: counting, now: () => now })
    expect(await reachable(base)).toBe(true)
    expect(await reachable("http://127.0.0.1:9")).toBe(false)
    expect(await reachable(base)).toBe(true)
    expect(calls).toBe(2)
    now += 30_001
    expect(await reachable(base)).toBe(true)
    expect(calls).toBe(3)
  })

  test("format lists title, URL, date and snippet", () => {
    const text = SearXNG.format("bun", [
      { url: "https://bun.sh", title: "Bun", content: "Fast runtime", publishedDate: "2026-01-02" },
      { url: "https://example.com" },
    ])
    expect(text).toBe(
      "1. Bun\n   https://bun.sh\n   Published: 2026-01-02\n   Fast runtime\n\n2. https://example.com\n   https://example.com",
    )
    expect(SearXNG.format("bun", [])).toContain("No search results")
  })
})
