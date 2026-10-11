/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import {
  DESKTOP_DEV_ORIGINS,
  InvalidOriginError,
  NATIVE_APP_ORIGINS,
  allowedBrowserOrigins,
  parseAllowedOrigin,
  refuseBrowserRequest,
} from "../../src/server/browser-origin"

const SERVER = "http://127.0.0.1:4096"
const DEFAULT_ALLOWED = allowedBrowserOrigins()

function refusal(input: { origin?: string | null; secFetchSite?: string | null; allowed?: readonly string[]; sameOrigin?: string }) {
  return refuseBrowserRequest({
    origin: input.origin ?? null,
    secFetchSite: input.secFetchSite ?? null,
    sameOrigin: input.sameOrigin ?? SERVER,
    allowed: input.allowed ?? DEFAULT_ALLOWED,
  })
}

describe("parseAllowedOrigin: only exact http(s) origins are configurable", () => {
  test("accepts an exact origin, with or without a trailing slash", () => {
    expect(parseAllowedOrigin("http://localhost:3000")).toBe("http://localhost:3000")
    expect(parseAllowedOrigin("https://app.example.com:8443/")).toBe("https://app.example.com:8443")
  })

  test("refuses wildcards, including a port wildcard", () => {
    expect(() => parseAllowedOrigin("*")).toThrow(InvalidOriginError)
    expect(() => parseAllowedOrigin("http://localhost:*")).toThrow(InvalidOriginError)
    expect(() => parseAllowedOrigin("http://127.0.0.1:*")).toThrow(InvalidOriginError)
  })

  test("refuses a path, a query, a fragment and user information", () => {
    expect(() => parseAllowedOrigin("http://localhost:3000/app")).toThrow(InvalidOriginError)
    expect(() => parseAllowedOrigin("http://localhost:3000?x=1")).toThrow(InvalidOriginError)
    expect(() => parseAllowedOrigin("http://localhost:3000#x")).toThrow(InvalidOriginError)
    expect(() => parseAllowedOrigin("http://user:pass@localhost:3000")).toThrow(InvalidOriginError)
  })

  test("refuses other schemes and things that are not origins", () => {
    expect(() => parseAllowedOrigin("tauri://localhost")).toThrow(InvalidOriginError)
    expect(() => parseAllowedOrigin("ftp://example.com")).toThrow(InvalidOriginError)
    expect(() => parseAllowedOrigin("localhost:3000")).toThrow(InvalidOriginError)
    expect(() => parseAllowedOrigin("not a url")).toThrow(InvalidOriginError)
  })
})

describe("allowedBrowserOrigins: the trusted set", () => {
  test("contains the desktop app's origins and its dev server, and nothing else by default", () => {
    for (const origin of [...NATIVE_APP_ORIGINS, ...DESKTOP_DEV_ORIGINS]) expect(DEFAULT_ALLOWED).toContain(origin)
    expect(DEFAULT_ALLOWED).toHaveLength(NATIVE_APP_ORIGINS.length + DESKTOP_DEV_ORIGINS.length)
  })

  test("does not trust other localhost ports, or the removed upstream website", () => {
    expect(DEFAULT_ALLOWED).not.toContain("http://localhost:3000")
    expect(DEFAULT_ALLOWED).not.toContain("http://127.0.0.1:1420")
    expect(DEFAULT_ALLOWED).not.toContain("https://opencode.ai")
  })

  test("adds configured origins once, and refuses an invalid configured one at startup", () => {
    expect(allowedBrowserOrigins(["http://localhost:3000", "http://localhost:3000/"])).toContain("http://localhost:3000")
    expect(allowedBrowserOrigins(["http://localhost:3000", "http://localhost:3000/"]).filter((o) => o === "http://localhost:3000")).toHaveLength(1)
    expect(() => allowedBrowserOrigins(["http://localhost:*"])).toThrow(InvalidOriginError)
  })
})

describe("refuseBrowserRequest: negative cases", () => {
  test("a cross-origin page is refused by its Origin, on any method", () => {
    expect(refusal({ origin: "https://evil.example" })).toBe("untrusted-origin")
  })

  test("a page on another localhost port is refused unless it was configured", () => {
    expect(refusal({ origin: "http://localhost:3000" })).toBe("untrusted-origin")
    expect(refusal({ origin: "http://127.0.0.1:5173" })).toBe("untrusted-origin")
  })

  test("an opaque origin (sandboxed frame) is refused", () => {
    expect(refusal({ origin: "null" })).toBe("untrusted-origin")
  })

  test("a cross-site browser request is refused even without an Origin", () => {
    expect(refusal({ secFetchSite: "cross-site" })).toBe("cross-site-request")
  })

  test("a same-site request from an untrusted origin is refused: another port on the same host is not trusted", () => {
    expect(refusal({ origin: "http://localhost:3000", secFetchSite: "same-site" })).toBe("untrusted-origin")
    expect(refusal({ secFetchSite: "same-site" })).toBe("cross-site-request")
  })

  test("a configured origin does not extend to a different scheme or host", () => {
    const allowed = allowedBrowserOrigins(["http://localhost:3000"])
    expect(refusal({ origin: "https://localhost:3000", allowed })).toBe("untrusted-origin")
    expect(refusal({ origin: "http://localhost:30000", allowed })).toBe("untrusted-origin")
  })
})

describe("refuseBrowserRequest: legitimate paths keep working", () => {
  test("the packaged desktop webview is trusted on every platform's origin", () => {
    expect(refusal({ origin: "tauri://localhost", secFetchSite: "cross-site" })).toBeUndefined()
    expect(refusal({ origin: "http://tauri.localhost", secFetchSite: "cross-site" })).toBeUndefined()
    expect(refusal({ origin: "https://tauri.localhost", secFetchSite: "cross-site" })).toBeUndefined()
  })

  test("the desktop dev server on localhost:1420 is trusted", () => {
    expect(refusal({ origin: "http://localhost:1420", secFetchSite: "same-site" })).toBeUndefined()
  })

  test("the server's own page is trusted, even at an address that is not in the list", () => {
    expect(refusal({ origin: "http://192.168.1.20:4096", sameOrigin: "http://192.168.1.20:4096", secFetchSite: "same-origin" })).toBeUndefined()
  })

  test("a configured dev origin is trusted once it is listed", () => {
    const allowed = allowedBrowserOrigins(["http://localhost:3000"])
    expect(refusal({ origin: "http://localhost:3000", secFetchSite: "same-site", allowed })).toBeUndefined()
  })

  test("a native or command-line client, which sends neither header, is not refused here: it still needs credentials", () => {
    expect(refusal({})).toBeUndefined()
  })

  test("a browser's own navigation, with no Origin, is not refused here", () => {
    expect(refusal({ secFetchSite: "none" })).toBeUndefined()
    expect(refusal({ secFetchSite: "same-origin" })).toBeUndefined()
  })
})
