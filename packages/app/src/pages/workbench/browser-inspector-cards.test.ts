/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { BrowserSession, P3Capability } from "@unifia/contracts"
import { inspectorRows } from "@/context/mode-inspector"
import { dict as en } from "@/i18n/en"
import { browserInspectorCards } from "./browser-inspector-cards"

const t = (key: string) => (en as Record<string, string>)[key]!

const session = {
  id: "browser-a",
  workspaceId: "workspace-a",
  profileId: "profile-a",
  runtimeProfile: "isolated",
  controller: "user",
  tabs: [
    { id: "tab-a", pageId: "page-a", url: "https://a.dev/", origin: "https://a.dev", title: "A", loading: false, canGoBack: false, canGoForward: false, status: "ready" },
  ],
  activeTabId: "tab-a",
  viewport: { width: 1280, height: 800 },
  status: "ready",
  createdAt: 1,
  updatedAt: 1,
} as BrowserSession

const rowsOf = (input: Parameters<typeof browserInspectorCards>[0], index: number) =>
  Object.fromEntries(inspectorRows(browserInspectorCards(input, t)[index]!).map((row) => [row.label, row.value]))

describe("browserInspectorCards", () => {
  test("LiveSession_ShowsControllerAddressAndViewport", () => {
    expect(rowsOf({ session, capabilities: [] }, 0)).toMatchObject({
      Controller: "You",
      Address: "https://a.dev/",
      Tabs: "1",
      Viewport: "1280 × 800",
      Profile: "isolated",
    })
  })

  test("Permissions_DistinguishApprovalGatedFromBlocked", () => {
    const capabilities = ["browser.navigate", "browser.interact"] as P3Capability[]
    expect(rowsOf({ session, capabilities }, 1)).toEqual({
      Navigate: "Allowed",
      "Click and type": "Allowed",
      Downloads: "Approval required",
      Uploads: "Approval required",
      "Sensitive actions": "Approval required",
    })
    expect(rowsOf({ session, capabilities: [] }, 1)).toMatchObject({ Navigate: "Blocked" })
  })

  test.each([
    ["user", "Public HTTP(S), default deny"],
    ["ai", "Session origins, default deny"],
    ["paused", "Blocked"],
  ] as const)("Controller_%s_ReportsTheActiveEgressPolicy", (controller, network) => {
    expect(rowsOf({ session: { ...session, controller }, capabilities: [] }, 0)).toMatchObject({ Network: network })
  })

  test("Connecting_ClaimsNoControlOrPermissions", () => {
    expect(rowsOf(undefined, 0)).toEqual({ Status: "Connecting" })
  })
})
