/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { browserHandoffState, browserNavigationRequest, normalizeBrowserAddress, shouldSyncBrowserAddress } from "@/pages/workbench/design-browser-model"

describe("normalizeBrowserAddress", () => {
  test("promotes a bare host to https", () => {
    expect(normalizeBrowserAddress("example.com")).toBe("https://example.com/")
  })
  test("keeps an explicit http scheme", () => {
    expect(normalizeBrowserAddress("http://example.com/path")).toBe("http://example.com/path")
  })
  test("keeps an explicit https scheme with query and port", () => {
    expect(normalizeBrowserAddress("https://example.com:8443/a?b=1")).toBe("https://example.com:8443/a?b=1")
  })
  test("trims surrounding whitespace", () => {
    expect(normalizeBrowserAddress("  example.com  ")).toBe("https://example.com/")
  })
  test("refuses empty and whitespace-only input", () => {
    expect(normalizeBrowserAddress("")).toBe("")
    expect(normalizeBrowserAddress("   ")).toBe("")
  })
  // The Rust command refuses anything but http(s); catching it here keeps the
  // refusal explainable instead of surfacing a Rust error string.
  test("refuses a non-http scheme rather than promoting it", () => {
    expect(normalizeBrowserAddress("file:///etc/passwd")).toBe("")
    expect(normalizeBrowserAddress("javascript://alert(1)")).toBe("")
    expect(normalizeBrowserAddress("data://text/html,x")).toBe("")
  })
  test("refuses a scheme that names no host", () => {
    expect(normalizeBrowserAddress("https://")).toBe("")
  })
})

describe("browserNavigationRequest", () => {
  test("accepts a request to hand a normalized URL to the shared Browser mode", () => {
    expect(browserNavigationRequest({ browserInitialUrl: "example.com", browserInitialRequestId: "request-1" })).toEqual({
      url: "https://example.com/",
      requestId: "request-1",
    })
  })

  test("ignores malformed and non-http navigation requests", () => {
    expect(browserNavigationRequest({ browserInitialUrl: "javascript:alert(1)", browserInitialRequestId: "request-2" })).toBeUndefined()
    expect(browserNavigationRequest({ browserInitialUrl: "https://example.com" })).toBeUndefined()
  })
})

describe("shouldSyncBrowserAddress", () => {
  test("does not replace a user draft while the displayed page is unchanged", () => {
    expect(shouldSyncBrowserAddress({ tabId: "tab-1", url: "https://example.com/" }, { tabId: "tab-1", url: "https://example.com/" })).toBe(false)
  })
  test("syncs the address when the active tab or page URL changes", () => {
    expect(shouldSyncBrowserAddress({ tabId: "tab-1", url: "https://example.com/" }, { tabId: "tab-2", url: "about:blank" })).toBe(true)
    expect(shouldSyncBrowserAddress({ tabId: "tab-1", url: "https://example.com/" }, { tabId: "tab-1", url: "https://example.com/next" })).toBe(true)
  })
})

describe("browserHandoffState", () => {
  test("what Design hands over is exactly what the Browser destination reads back", () => {
    const state = browserHandoffState("  example.com/docs ", "request-7")

    expect(browserNavigationRequest(state)).toEqual({ url: "https://example.com/docs", requestId: "request-7" })
  })

  test("an address the Browser may not open produces no handoff", () => {
    expect(browserHandoffState("", "request-8")).toBeUndefined()
    expect(browserHandoffState("file:///etc/passwd", "request-9")).toBeUndefined()
  })

  test("a handoff without a request id is refused, as its reader would drop it", () => {
    expect(browserHandoffState("example.com", "")).toBeUndefined()
  })
})
