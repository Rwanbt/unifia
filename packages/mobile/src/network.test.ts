import { expect, test } from "bun:test"
import { routeFetch } from "./network"

const browser = (() => Promise.resolve(new Response("browser"))) as typeof fetch
const native = (() => Promise.resolve(new Response("native"))) as typeof fetch
const request = routeFetch(browser, native, "http://tauri.localhost")

test("static APK assets stay within the WebView", async () => {
  expect(await (await request("/index.html")).text()).toBe("browser")
})

test("remote HTTPS requests use the native transport", async () => {
  expect(await (await request("https://example.opentunnel.xyz/server/info")).text()).toBe("native")
})

test("native requests forbid redirects at the Rust transport boundary", async () => {
  const calls: Array<RequestInit & { maxRedirections?: number }> = []
  const authHeaders: Array<string | null> = []
  const routed = routeFetch(browser, ((_, init) => {
    authHeaders.push(_ instanceof Request ? _.headers.get("Authorization") : null)
    calls.push(init ?? {})
    return Promise.resolve(new Response("ok"))
  }) as typeof fetch, "http://tauri.localhost")
  await routed(new Request("https://example.opentunnel.xyz/server/info", {
    headers: { Authorization: "Basic demo" },
  }))
  expect(calls[0]?.redirect).toBe("error")
  expect(calls[0]?.maxRedirections).toBe(0)
  expect(authHeaders[0]).toBe("Basic demo")
})

test("caller cannot override the zero-redirect policy", async () => {
  const calls: Array<RequestInit & { maxRedirections?: number }> = []
  const routed = routeFetch(browser, ((_, init) => {
    calls.push(init ?? {})
    return Promise.resolve(new Response("ok"))
  }) as typeof fetch, "http://tauri.localhost")
  await routed("https://example.org", { redirect: "follow", maxRedirections: 12 } as RequestInit)
  expect(calls[0]?.maxRedirections).toBe(0)
  expect(calls[0]?.redirect).toBe("error")
})

test("HTTP loopback works for testing through adb reverse", async () => {
  expect(await (await request(new Request("http://127.0.0.1:45278/server/info"))).text()).toBe("native")
})

test("non-loopback plain HTTP is rejected", async () => {
  await expect(request("http://192.168.1.2:4096/server/info")).rejects.toThrow("HTTPS")
})

test("non-HTTP schemes are rejected", async () => {
  await expect(request("file:///etc/passwd")).rejects.toThrow("HTTPS")
})
