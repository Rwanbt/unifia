/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { inspectorRows } from "@/context/mode-inspector"
import { dict as en } from "@/i18n/en"
import { settingsInspectorCards } from "./settings-inspector-cards"

const t = (key: string) => (en as Record<string, string>)[key]!
const rowsOf = (card: Parameters<typeof inspectorRows>[0]) => Object.fromEntries(inspectorRows(card).map((row) => [row.label, row.value]))

describe("settingsInspectorCards", () => {
  test("ActivePage_ShowsSectionAndPageOnly", () => {
    const [card] = settingsInspectorCards({ section: "Desktop", page: "General" }, t)
    expect(card).toMatchObject({ title: "Settings" })
    expect(rowsOf(card!)).toEqual({ Section: "Desktop", Page: "General" })
  })
  test("UnknownPage_ShowsNoRows", () => {
    expect(inspectorRows(settingsInspectorCards({ section: undefined, page: undefined }, t)[0]!)).toEqual([])
  })
})

