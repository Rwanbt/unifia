/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  CONSOLE_SERVER,
  OpencodeConsoleAuthPlugin,
  consoleHeaders,
  needsRefresh,
  pollDeviceToken,
  refreshConsoleToken,
  requestDeviceCode,
} from "../../src/plugin/opencode-console"

type Call = { url: string; body: Record<string, unknown> }

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) })
    const next = responses.shift()
    if (!next) throw new Error("unexpected request")
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as typeof fetch
  return { impl, calls }
}

const noWait = async () => {}

describe("plugin.opencode-console", () => {
  test("requestDeviceCode resolves the relative verification path against the Console", async () => {
    const { impl, calls } = fakeFetch([
      {
        body: {
          device_code: "dev",
          user_code: "ABCD-EFGH",
          verification_uri_complete: "/console/device?user_code=ABCD-EFGH&client_id=opencode-cli",
          interval: 5,
        },
      },
    ])
    const device = await requestDeviceCode(impl)
    expect(device.url).toBe("https://opencode.ai/console/device?user_code=ABCD-EFGH&client_id=opencode-cli")
    expect(calls[0]).toEqual({
      url: `${CONSOLE_SERVER}/auth/device/code`,
      body: { client_id: "opencode-cli", supports_org_scope: true },
    })
  })

  test("pollDeviceToken waits through pending and slow_down, then returns the token", async () => {
    const waits: number[] = []
    const { impl, calls } = fakeFetch([
      { status: 400, body: { error: "authorization_pending" } },
      { status: 400, body: { error: "slow_down" } },
      { body: { access_token: "acc", refresh_token: "ref", expires_in: 100, org_id: "wrk_1" } },
    ])
    const token = await pollDeviceToken(
      { device_code: "dev", interval: 5 },
      { fetch: impl, wait: async (ms) => waits.push(ms), now: () => 1_000 },
    )
    expect(token).toEqual({ access: "acc", refresh: "ref", expires: 101_000, orgID: "wrk_1" })
    expect(waits).toEqual([5_000, 5_000, 10_000])
    expect(calls[0].body).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "dev",
      client_id: "opencode-cli",
    })
  })

  test("pollDeviceToken fails on a terminal error instead of polling forever", async () => {
    const { impl } = fakeFetch([{ status: 400, body: { error: "access_denied" } }])
    await expect(pollDeviceToken({ device_code: "dev", interval: 1 }, { fetch: impl, wait: noWait })).rejects.toThrow(
      "access_denied",
    )
  })

  test("refreshConsoleToken keeps the organization when the Console omits it", async () => {
    const { impl, calls } = fakeFetch([{ body: { access_token: "a2", refresh_token: "r2", expires_in: 10 } }])
    const token = await refreshConsoleToken({ refresh: "r1", orgID: "wrk_1" }, { fetch: impl, now: () => 0 })
    expect(token).toEqual({ access: "a2", refresh: "r2", expires: 10_000, orgID: "wrk_1" })
    expect(calls[0].body).toEqual({ grant_type: "refresh_token", refresh_token: "r1", client_id: "opencode-cli" })
  })

  test("refreshConsoleToken reports a revoked session as a sign-in requirement", async () => {
    const { impl } = fakeFetch([{ status: 400, body: { error: "invalid_grant" } }])
    await expect(refreshConsoleToken({ refresh: "r1" }, { fetch: impl })).rejects.toThrow("sign in again")
  })

  test("needsRefresh triggers inside the safety margin", () => {
    expect(needsRefresh(1_000_000, 1_000_000 - 120_000)).toBe(false)
    expect(needsRefresh(1_000_000, 1_000_000 - 30_000)).toBe(true)
  })

  test("consoleHeaders carries the organization only when known", () => {
    expect(consoleHeaders({ access: "a", orgID: "wrk_1" })).toEqual({
      authorization: "Bearer a",
      "x-opencode-org-id": "wrk_1",
    })
    expect(consoleHeaders({ access: "a" })).toEqual({ authorization: "Bearer a" })
  })
})

describe("plugin.opencode-console hooks", () => {
  type Saved = { id: string; body: Record<string, unknown> }

  async function setup(providerID: "opencode" | "opencode-go") {
    const saved: Saved[] = []
    const input = {
      client: { auth: { set: async (req: { path: { id: string }; body: Record<string, unknown> }) => saved.push({ id: req.path.id, body: req.body }) } },
    } as unknown as Parameters<ReturnType<typeof OpencodeConsoleAuthPlugin>>[0]
    const hooks = await OpencodeConsoleAuthPlugin(providerID)(input)
    return { hooks, saved }
  }
  function withFetch(handler: (url: string, init?: RequestInit) => Response) {
    const original = globalThis.fetch
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return handler(String(url), init)
    }) as typeof fetch
    return { calls, restore: () => (globalThis.fetch = original) }
  }
  test("the loader sends the Console token and organization on every request", async () => {
    const { hooks } = await setup("opencode-go")
    const auth = { type: "oauth" as const, access: "acc", refresh: "ref", expires: Date.now() + 3_600_000, accountId: "wrk_1" }
    const options = await hooks.auth!.loader!(async () => auth, {} as never)
    const stub = withFetch(() => new Response("{}"))
    try {
      await options.fetch("https://opencode.ai/inference/go/openai/v1/chat/completions", { headers: { "x-keep": "1" } })
    } finally {
      stub.restore()
    }
    const headers = new Headers(stub.calls[0]!.init?.headers)
    expect(headers.get("authorization")).toBe("Bearer acc")
    expect(headers.get("x-opencode-org-id")).toBe("wrk_1")
    expect(headers.get("x-keep")).toBe("1")
  })

  test("an expired token is refreshed first and stored for both Console providers", async () => {
    const { hooks, saved } = await setup("opencode")
    const auth = { type: "oauth" as const, access: "old", refresh: "r1", expires: Date.now() - 1, accountId: "wrk_1" }
    const options = await hooks.auth!.loader!(async () => auth, {} as never)
    const stub = withFetch((url) =>
      url.endsWith("/auth/device/token")
        ? new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 }))
        : new Response("{}"),
    )
    try {
      await options.fetch("https://opencode.ai/zen/v1/chat/completions", {})
    } finally {
      stub.restore()
    }
    expect(saved.map((entry) => entry.id)).toEqual(["opencode", "opencode-go"])
    expect(saved[0]!.body).toMatchObject({ type: "oauth", access: "new", refresh: "r2", accountId: "wrk_1" })
    expect(new Headers(stub.calls[1]!.init?.headers).get("authorization")).toBe("Bearer new")
  })

  test("an API key credential keeps the default transport", async () => {
    const { hooks } = await setup("opencode-go")
    expect(await hooks.auth!.loader!(async () => ({ type: "api", key: "k" }) as never, {} as never)).toEqual({})
  })

  test("chat.headers adds the session id only for its own provider", async () => {
    const { hooks } = await setup("opencode-go")
    const run = async (providerID: string) => {
      const output = { headers: {} as Record<string, string> }
      await hooks["chat.headers"]!({ sessionID: "ses_1", model: { providerID } } as never, output)
      return output.headers
    }
    expect(await run("opencode-go")).toEqual({ "x-opencode-session": "ses_1" })
    expect(await run("openai")).toEqual({})
  })
})
