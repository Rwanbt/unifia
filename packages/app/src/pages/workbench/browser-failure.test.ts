/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { WorkbenchHttpError } from "@unifia/workbench-shell"
import { describeBrowserFailure } from "./browser-failure"

const t = (key: string, params?: Record<string, string>) => (params?.detail ? `${key}|${params.detail}` : key)

describe("describeBrowserFailure", () => {
  test("names the native lease refusal, which Tauri rejects as a bare string", () => {
    expect(describeBrowserFailure("capability not allowed at connection: browser.navigate", t)).toBe(
      "browser.surface.leaseRefused|capability not allowed at connection: browser.navigate",
    )
  })

  test("maps a lost or narrowed token to a reconnect hint", () => {
    expect(describeBrowserFailure(new WorkbenchHttpError(401, false), t)).toBe("browser.surface.accessDenied")
    expect(describeBrowserFailure(new WorkbenchHttpError(403, false), t)).toBe("browser.surface.accessDenied")
  })

  test("keeps the host install failure", () => {
    expect(describeBrowserFailure(new WorkbenchHttpError(503, false, "BROWSER_HOST_UNAVAILABLE"), t)).toBe("browser.surface.hostUnavailable")
  })

  test("leaves retryable failures to the generic message", () => {
    expect(describeBrowserFailure(new WorkbenchHttpError(502, true), t)).toBeUndefined()
    expect(describeBrowserFailure(new Error("socket hang up"), t)).toBeUndefined()
  })
})
