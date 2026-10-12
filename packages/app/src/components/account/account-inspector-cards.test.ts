/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { inspectorRows } from "@/context/mode-inspector"
import { dict as en } from "@/i18n/en"
import { accountInspectorCards } from "./account-inspector-cards"

const t = (key: string) => (en as Record<string, string>)[key]!
const rowsOf = (card: Parameters<typeof inspectorRows>[0]) => Object.fromEntries(inspectorRows(card).map((row) => [row.label, row.value]))

describe("accountInspectorCards", () => {
  test("SignedOut_ShowsTheLocalProfileWithoutInventedSessionCounts", () => {
    const cards = accountInspectorCards({ name: "User", summary: "Local", page: "Overview", organisation: undefined, projectCount: 3 }, t)
    expect(cards[0]).toEqual({ title: "User", description: "Local" })
    expect(rowsOf(cards[1]!)).toEqual({ Page: "Overview", Organisation: "—", Projects: "3" })
  })
})
