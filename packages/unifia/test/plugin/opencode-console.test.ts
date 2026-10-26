/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  CONSOLE_SERVER,
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
