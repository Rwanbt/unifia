/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { inspectorRows } from "@/context/mode-inspector"
import { dict as en } from "@/i18n/en"
import { browserInspectorCards } from "./browser-inspector-cards"

const t = (key: string) => (en as Record<string, string>)[key]!
const rowsOf = (input: Parameters<typeof browserInspectorCards>[0]) =>
  Object.fromEntries(inspectorRows(browserInspectorCards(input, t)[0]!).map((row) => [row.label, row.value]))

describe("browserInspectorCards", () => {
  test("NothingOpened_SaysNoWindowAndInventsNoPermissions", () => {
    expect(rowsOf({ windowLabel: undefined, address: "", fallbackUrl: "" })).toEqual({ Window: "No window open" })
  })
  test("NativeWindow_ShowsItsAddress", () => {
    expect(rowsOf({ windowLabel: "w1", address: "https://a.dev", fallbackUrl: "" })).toEqual({
      Window: "Native window open",
      Mode: "Native window",
      Address: "https://a.dev",
    })
  })
  test("InlineFallback_ShowsTheFramedAddress", () => {
    expect(rowsOf({ windowLabel: undefined, address: "https://a.dev", fallbackUrl: "https://a.dev" })).toEqual({
      Window: "No window open",
      Mode: "Inline frame (fallback)",
      Address: "https://a.dev",
    })
  })
})
