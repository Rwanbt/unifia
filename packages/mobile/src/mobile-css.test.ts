/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const css = readFileSync(resolve(import.meta.dir, "mobile.css"), "utf8")
const PHONE = "@media (max-width: 839px), (max-height: 520px) and (max-width: 899px) and (orientation: landscape) {"

function phoneBlock(): string {
  const start = css.indexOf(PHONE)
  expect(start).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf("\n}\n", start))
}

describe("mobile composer layout (maquette v110 phone)", () => {
  test("controls form one row of equal cells sized from the composer width", () => {
    const phone = phoneBlock()
    expect(phone).toContain("--pc-cells: 7;")
    expect(phone).toContain("--pc-cell: calc((100cqw - (var(--pc-cells) - 1) * var(--pc-gap)) / var(--pc-cells));")
    expect(phone).toContain("height: 36px !important;")
    expect(phone).toContain("border-radius: 11px !important;")
  })

  test("selectors show only their icon and Live leaves the composer for the topbar orb", () => {
    const phone = phoneBlock()
    expect(phone).toContain('[data-v110="prompt-control"] :is([data-slot="select-select-trigger-value"], span.truncate, [data-slot="select-select-trigger-icon"]) {\n    display: none !important;')
    expect(phone).toContain('[data-component="tooltip-trigger"]:has(> [data-action="prompt-live-toggle"])')
  })

  test("the cell rule never resizes send or the context meter", () => {
    // Sized as a cell, the meter covered send and took its taps.
    expect(phoneBlock()).toContain(':not([data-action="prompt-submit"], [data-action="prompt-context"])')
  })

  test("tablets keep the stacked strip sized for 44px targets", () => {
    expect(css).toContain('[data-v110="prompt-composer"] {\n  --v110-prompt-action-size: 44px;\n}')
  })
})
