/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { filterSettingRows, matchesSettingQuery } from "./settings-search"

describe("settings search", () => {
  test("ignores accents and case", () => {
    expect(matchesSettingQuery("Mémoire du projet", "MEMOIRE")).toBe(true)
    expect(matchesSettingQuery("Langue", "police")).toBe(false)
  })

  test("an empty query matches everything", () => {
    expect(matchesSettingQuery("Langue", "  ")).toBe(true)
  })

  test("hides only the rows of the page that do not match", () => {
    document.body.innerHTML = `<div id="page">
      <div data-v110="setting-row">Langue</div>
      <div data-v110="setting-row">Police de code</div>
    </div>`
    const page = document.getElementById("page")!
    filterSettingRows(page, "police")
    const rows = [...page.querySelectorAll<HTMLElement>('[data-v110="setting-row"]')]
    expect(rows.map((row) => row.hidden)).toEqual([true, false])
    filterSettingRows(page, "")
    expect(rows.map((row) => row.hidden)).toEqual([false, false])
  })
})
