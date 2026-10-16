/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"

// V08 (issue #553, criterion 3): an affordance that only hover reveals must have
// a keyboard and a touch equivalent.
//
// Two facts make a `group-hover:`-only reveal a defect rather than a nicety:
//  - Tailwind 4 wraps every `hover:` variant in `@media (hover: hover)`
//    (node_modules/tailwindcss/dist/lib.js: r.static("hover", c => { c.nodes =
//    [M("&:hover", [F("@media", "(hover: hover)", c.nodes)])] })), so on a
//    pointer without hover the reveal never fires and the control stays
//    invisible for good;
//  - `:focus-visible` is never implied by `:hover`, so a keyboard user focuses
//    an invisible button.
//
// The provider tree cannot be rendered in plain Node in this package (see
// team-dialog-host.test.ts), so the contract is pinned at the source level, the
// same way design-toolbar.test.ts pins the touch-target and motion-reduce
// classes.
const APP_SRC = resolve(import.meta.dir, "..", "..")
const UI_SRC = resolve(import.meta.dir, "..", "..", "..", "..", "ui", "src")
const COMPONENT = resolve(import.meta.dir, "./image-attachments.tsx")

const component = readFileSync(COMPONENT, "utf-8")

// Any of these gives a keyboard user a reason to believe the control exists.
const NON_HOVER_REVEAL = /(?:group-)?focus(?:-visible|-within)?(?:\/[a-z-]+)?:opacity-100/

// Hover reveals that are decoration, not affordances: nothing interactive is
// hidden and the surrounding label keeps saying what the element is. Each entry
// is a distinctive substring of the accepted line.
const DECORATIVE_HOVER_REVEALS = [
  // The file row shows its colour favicon instead of the mono one on hover.
  "filetree-icon filetree-icon--color",
]

function componentSources(root: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) found.push(...componentSources(path))
    else if (entry.name.endsWith(".tsx")) found.push(path)
  }
  return found
}

describe("prompt image attachments - the remove control is not hover-only (#553)", () => {
  test("the remove control is revealed on keyboard focus, not only on hover", () => {
    expect(component).toMatch(/group-hover:opacity-100/)
    expect(component).toMatch(/focus-visible:opacity-100/)
  })

  test("a pointer without hover keeps the remove control visible", () => {
    // `group-hover:opacity-100` lives behind `@media (hover: hover)`, so hide
    // the control only where a hover actually exists.
    expect(component).toMatch(/createMediaQuery\("\(hover: none\)"\)/)
    expect(component).toMatch(/"opacity-0 group-hover:opacity-100 focus-visible:opacity-100": !isTouch\(\)/)
    expect(component).toMatch(/"opacity-60": isTouch\(\)/)
  })

  test("no affordance in the app or ui source is revealed only by hover", () => {
    const violations: string[] = []
    for (const file of [...componentSources(APP_SRC), ...componentSources(UI_SRC)]) {
      readFileSync(file, "utf-8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (!line.includes("opacity-0")) return
          if (!/group-hover(?:\/[a-z-]+)?:opacity-100/.test(line)) return
          if (NON_HOVER_REVEAL.test(line)) return
          // A `pointer-events-none` overlay cannot be activated at all.
          if (line.includes("pointer-events-none")) return
          if (DECORATIVE_HOVER_REVEALS.some((token) => line.includes(token))) return
          violations.push(`${relative(APP_SRC, file)}:${index + 1}`)
        })
    }
    expect(violations).toEqual([])
  })
})
