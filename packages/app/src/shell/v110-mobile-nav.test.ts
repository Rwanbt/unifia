/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Static contract (same style as design-split.test.tsx): the bar renders
// what it is given, stays phone-only, keeps touch targets and safe areas.
// Plain substring matchers: no regex escaping pitfalls.
const dir = join(import.meta.dir, ".");
const nav = readFileSync(join(dir, "v110-mobile-nav.tsx"), "utf8")
const css = readFileSync(join(dir, "v110-shell.css"), "utf8")
const bar = readFileSync(join(dir, "../styles/v110-mobile.css"), "utf8")

describe("a2 mobile nav", () => {
  test("renders the given modes plus the shared destinations, never a second registry", () => {
    expect(nav.includes('data-v110="mobile-nav"')).toBe(true)
    expect(nav.includes("data-mode={mode}")).toBe(true)
    expect(nav.includes("aria-pressed={props.active() === destination}")).toBe(true)
    expect(nav.includes("PILL_DESTINATIONS")).toBe(true)
    expect(nav.includes("SHELL_MODES")).toBe(false)
    expect(nav.includes("useMode")).toBe(false)
  })
  test("more opens the quick-action strip", () => {
    expect(nav.includes('data-action="mobile-more"')).toBe(true)
    expect(nav.includes('data-v110="mobile-sheet"')).toBe(true)
    expect(nav.includes("aria-expanded={open()}")).toBe(true)
  })
  test("the bar keeps the notch clear", () => {
    expect(bar.includes("env(safe-area-inset-bottom)")).toBe(true)
    expect(bar.includes("env(safe-area-inset-left)")).toBe(true)
    expect(bar.includes("env(safe-area-inset-right)")).toBe(true)
    expect(css.includes("env(safe-area-inset-bottom)")).toBe(true)
  })
  test("phones only: hidden by default, no important", () => {
    expect(css.includes('[data-v110="mobile-nav"]')).toBe(true)
    expect(css.indexOf("display: none") !== -1 && css.indexOf("display: none") < css.indexOf("display: grid")).toBe(true)
    expect(css.includes("(max-width: 700px) and (orientation: portrait)")).toBe(true)
    expect(css.includes("!important")).toBe(false)
  })
  test("compact landscape overlays start after the compact rail", () => {
    expect(css.includes("max-height: 560px")).toBe(true)
    expect(css.includes("var(--v110-rail-compact, 62px)")).toBe(true)
  })
})
