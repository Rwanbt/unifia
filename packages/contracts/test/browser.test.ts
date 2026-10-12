/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * PostM3-R2 — Browser isolation (BR-01..02) (Plan V2.3.1 §218, ADR-013).
 *
 * Locked invariants (regression net, 10 tests):
 *   BR-01 Browser isolation (5):
 *     (1) BrowserIsolationSchema — parses minimal: csp, iframeSandbox default.
 *     (2) BrowserIsolationSchema — accepts an empty iframeSandbox (fully sandboxed).
 *     (3) BrowserIsolationSchema — rejects an empty csp string.
 *     (4) BrowserIsolationSchema — rejects unsupported sandbox tokens.
 *     (5) IFRAME_SANDBOX_VALUES — only the policy-approved token is present.
 *
 *   BR-02 Egress control (5):
 *     (6) BrowserEgressPolicySchema — parses with empty allowedOrigins
 *         (the default-deny baseline).
 *     (7) BrowserEgressPolicySchema — accepts an origin pattern
 *         (`https://api.example.com`).
 *     (8) BrowserEgressPolicySchema — rejects a non-origin string
 *         (no protocol).
 *     (9) BrowserEgressPolicySchema — blockThirdPartyCookies defaults to true.
 *     (10) parseBrowserEgressPolicy — round-trips a valid policy
 *          through JSON.
 *
 * Note: the existing M1 `BrowserAutomationBroker` (driver) is in the
 * same module but is not exercised here — that broker has its own
 * smoke test in `p3-lot3-smoke.ts`. The R2 scope is the *trust
 * boundary* (CSP / iframe sandbox / egress allowlist), not the
 * driver.
 */
import { describe, expect, test } from "bun:test"
import {
  IFRAME_SANDBOX_VALUES,
  BrowserInteractionActionSchema,
  BrowserSessionSchema,
  BrowserViewportSchema,
  type BrowserSession,
  parseBrowserIsolation,
  parseBrowserEgressPolicy,
} from "../src/browser.ts"

const BROWSER_SESSION: BrowserSession = {
  id: "browser-session-1",
  workspaceId: "workspace-1",
  chatSessionId: "ses_abc123",
  profileId: "browser-profile-1",
  runtimeProfile: "host-assisted",
  controller: "user",
  tabs: [
    {
      id: "tab-1",
      pageId: "page-1",
      url: "https://example.com/",
      origin: "https://example.com",
      title: "Example Domain",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      status: "ready",
    },
  ],
  activeTabId: "tab-1",
  viewport: { width: 1440, height: 900 },
  status: "ready",
  createdAt: 1,
  updatedAt: 1,
}

describe("Browser viewport contract", () => {
  test("accepts supported dimensions and rejects oversized values", () => {
    expect(BrowserViewportSchema.parse({ width: 4096, height: 2160 })).toEqual({ width: 4096, height: 2160 })
    expect(() => BrowserViewportSchema.parse({ width: 4097, height: 800 })).toThrow()
    expect(() => BrowserViewportSchema.parse({ width: 1280, height: 4097 })).toThrow()
  })
})

describe("BrowserSessionSchema", () => {
  test("accepts a session whose active tab belongs to the session", () => {
    expect(BrowserSessionSchema.parse(BROWSER_SESSION)).toEqual(BROWSER_SESSION)
  })

  test("requires the active tab to exist and forbids a missing active tab", () => {
    expect(() => BrowserSessionSchema.parse({ ...BROWSER_SESSION, activeTabId: "tab-missing" })).toThrow(/activeTabId/)
    expect(() => BrowserSessionSchema.parse({ ...BROWSER_SESSION, activeTabId: null })).toThrow(/activeTabId/)
  })

  test("allows an empty session only without an active tab", () => {
    expect(BrowserSessionSchema.parse({ ...BROWSER_SESSION, tabs: [], activeTabId: null }).tabs).toEqual([])
    expect(() => BrowserSessionSchema.parse({ ...BROWSER_SESSION, tabs: [], activeTabId: "tab-1" })).toThrow(/activeTabId/)
  })

  test("requires unique tab and page ids with monotonic timestamps", () => {
    const duplicateTab = { ...BROWSER_SESSION.tabs[0]!, pageId: "page-2" }
    expect(() => BrowserSessionSchema.parse({ ...BROWSER_SESSION, tabs: [BROWSER_SESSION.tabs[0], duplicateTab] })).toThrow(/unique/)
    expect(() => BrowserSessionSchema.parse({ ...BROWSER_SESSION, updatedAt: 0 })).toThrow(/updatedAt/)
  })

  test("requires canonical HTTP origins for page state", () => {
    const tab = { ...BROWSER_SESSION.tabs[0]!, origin: "https://example.com/path" }
    expect(() => BrowserSessionSchema.parse({ ...BROWSER_SESSION, tabs: [tab] })).toThrow()
  })
})

describe("Browser interaction contracts", () => {
  test("accepts hover and select actions", () => {
    expect(BrowserInteractionActionSchema.parse({ kind: "hover", selector: "button#menu" }).kind).toBe("hover")
    expect(BrowserInteractionActionSchema.parse({ kind: "select", selector: "select#sort", value: "newest" }).kind).toBe("select")
  })
})

// =========================================================================
// BR-01 — Browser isolation
// =========================================================================

describe("BR-01 Browser isolation — payload", () => {
  test("(1) BrowserIsolationSchema_ParsesMinimal — csp + defaults", () => {
    const parsed = parseBrowserIsolation({ csp: "default-src 'self'" })
    expect(parsed.csp).toBe("default-src 'self'")
    expect(parsed.iframeSandbox).toEqual([])
  })

  test("(2) BrowserIsolationSchema_AcceptsEmptySandbox — fully sandboxed", () => {
    const parsed = parseBrowserIsolation({
      csp: "default-src 'none'",
      iframeSandbox: [],
    })
    expect(parsed.iframeSandbox).toEqual([])
  })

  test("(3) BrowserIsolationSchema_RejectsEmptyCsp", () => {
    expect(() => parseBrowserIsolation({ csp: "" })).toThrow()
  })

  test("(4) BrowserIsolationSchema_RejectsUnsupportedSandboxTokens", () => {
    const denied = ["allow", "same-origin"].join("-")
    expect(() =>
      parseBrowserIsolation({
        csp: "default-src 'self'",
        iframeSandbox: [denied],
      }),
    ).toThrow(/disallowed token/)
  })

  test("(5) IFRAME_SANDBOX_VALUES_ContainsOnlyTheApprovedToken", () => {
    const parsed = parseBrowserIsolation({
      csp: "default-src 'self'",
      iframeSandbox: ["allow-scripts"],
    })
    expect(parsed.iframeSandbox).toEqual(["allow-scripts"])
    expect(IFRAME_SANDBOX_VALUES.has("allow-scripts")).toBe(true)
    expect(IFRAME_SANDBOX_VALUES.has("allow-forms")).toBe(false)
  })

  test("BrowserIsolationSchema_RejectsUnknownSandboxToken", () => {
    expect(() => parseBrowserIsolation({ csp: "default-src 'none'", iframeSandbox: ["allow-everything"] })).toThrow()
  })
})

// =========================================================================
// BR-02 — Egress control
// =========================================================================

describe("BR-02 Egress control — payload", () => {
  test("(6) BrowserEgressPolicySchema_ParsesDefaultDeny — empty allowedOrigins", () => {
    const parsed = parseBrowserEgressPolicy({ allowedOrigins: [] })
    expect(parsed.allowedOrigins).toEqual([])
    expect(parsed.blockThirdPartyCookies).toBe(true)
    expect(parsed.defaultDeny).toBe(true)
  })

  test("(7) BrowserEgressPolicySchema_AcceptsOriginPattern", () => {
    const parsed = parseBrowserEgressPolicy({
      allowedOrigins: ["https://api.example.com"],
    })
    expect(parsed.allowedOrigins).toEqual(["https://api.example.com"])
  })

  test("(8) BrowserEgressPolicySchema_RejectsBadOrigin — empty string", () => {
    // Empty origin fails the inner min(1) constraint.
    expect(() => parseBrowserEgressPolicy({ allowedOrigins: [""] })).toThrow()
  })

  test.each([
    "api.example.com",
    "https://api.example.com/path",
    "https://api.example.com/",
    "https://user@api.example.com",
    "file://api.example.com",
  ])("BrowserEgressPolicySchema_RejectsNonCanonicalOrigin %s", (origin) => {
    expect(() => parseBrowserEgressPolicy({ allowedOrigins: [origin] })).toThrow()
  })

  test("BrowserEgressPolicySchema_AllowsLiteralWildcardOnly", () => {
    expect(parseBrowserEgressPolicy({ allowedOrigins: ["*"] }).allowedOrigins).toEqual(["*"])
    expect(() => parseBrowserEgressPolicy({ allowedOrigins: ["https://*.example.com"] })).toThrow()
  })

  test("(9) BrowserEgressPolicySchema_DefaultsBlock3PCookies — true", () => {
    const parsed = parseBrowserEgressPolicy({ allowedOrigins: [] })
    expect(parsed.blockThirdPartyCookies).toBe(true)
  })

  test("(10) parseBrowserEgressPolicy_RoundTripsValid", () => {
    const original = {
      allowedOrigins: ["https://a.example.com", "https://b.example.com"],
      blockThirdPartyCookies: true,
      defaultDeny: true,
    }
    const parsed = parseBrowserEgressPolicy(original)
    const round = JSON.parse(JSON.stringify(parsed))
    expect(round).toEqual(original)
  })
})
