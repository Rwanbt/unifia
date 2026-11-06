/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { isNavigationRace } from "../src/playwright-session-pages.ts"

test("NavigationRace_ContextDestroyedByNavigation_IsRetryable", () => {
  expect(isNavigationRace(new Error("page.screenshot: Execution context was destroyed, most likely because of a navigation"))).toBe(true)
})

test("NavigationRace_OtherFailures_AreNot", () => {
  expect(isNavigationRace(new Error("page.screenshot: Target page, context or browser has been closed"))).toBe(false)
  expect(isNavigationRace("Execution context was destroyed")).toBe(false)
})
