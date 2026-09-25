/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const css = readFileSync(resolve(import.meta.dir, "mobile.css"), "utf8")

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf("}", start))
}

describe("mobile composer layout", () => {
  test("the composer reserves its actions strip for the 44px touch targets", () => {
    // v110-chat.css sizes the strip under the selectors from this variable;
    // left at the app's 28px, dictation, Live and send slid under the selectors.
    expect(css).toContain("[data-action=\"prompt-submit\"],\n[data-action=\"prompt-attach\"] {\n  width: 44px !important;")
    expect(rule('[data-v110="prompt-composer"]')).toContain("--v110-prompt-action-size: 44px;")
  })

  test("the attach slot is as tall as the attach button it clips", () => {
    const slot = rule('[data-v110="prompt-footer-controls"] > [data-v110="prompt-attach-slot"]')
    expect(slot).toContain("width: 44px !important;")
    expect(slot).toContain("height: 44px !important;")
  })

  test("wrappers inside a selector cannot size past its bound", () => {
    expect(css).toContain(':is([data-component="tooltip-trigger"], [data-component="select"]) {\n  width: 100% !important;')
  })
})
