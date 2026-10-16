/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SEP = resolve(import.meta.dir, "./separator.tsx")
const source = readFileSync(SEP, "utf-8")

// Static contract: the primitive stays keyboard-accessible and free of
// sync hacks. Follows the repo pattern (design-split.test.tsx).
describe("v110 separator primitive", () => {
  test("exposes the separator role with full value semantics", () => {
    expect(source).toMatch(/role="separator"/)
    expect(source).toMatch(/aria-orientation=\{orientation\(local\.axis\)\}/)
    expect(source).toMatch(/aria-label=\{local\.label\}/)
    expect(source).toMatch(/aria-valuenow=\{Math\.round\(local\.size\)\}/)
    expect(source).toMatch(/aria-valuemin=\{local\.min\}/)
    expect(source).toMatch(/aria-valuemax=\{local\.max\}/)
    expect(source).toMatch(/tabindex="0"/)
    expect(source).toMatch(/data-component="separator"/)
    expect(source).toMatch(/data-axis=\{local\.axis\}/)
  })

  test("wires keyboard and pointer handlers from the token contract", () => {
    expect(source).toMatch(/onKeyDown=\{onKeyDown\}/)
    expect(source).toMatch(/onPointerDown=\{onPointerDown\}/)
    expect(source).toMatch(/delta\(event\.key, event\.shiftKey\)/)
    expect(source).toMatch(/event\.key === "Home"/)
    expect(source).toMatch(/event\.key === "End"/)
    expect(source).toMatch(/drag\(base, origin, at\(move\), edge\)/)
    expect(source).toMatch(/from "@\/tokens\/resizer"/)
  })

  test("keys resolve the separator edge the way the drag does", () => {
    // An "end" separator has its sized pane after the handle, so a step in the
    // handle's direction shortens it. Both handlers must resolve the edge from
    // one place; the behaviour is certified in
    // e2e/v110/memory-resizer-keyboard.spec.ts.
    expect(source).toMatch(/const edgeOf = \(\) => local\.edge \?\? \(local\.axis === "x" \? "start" : "end"\)/)
    expect(source.match(/const edge = edgeOf\(\)/g) ?? []).toHaveLength(2)
  })

  test("left-button drags only and always cleans listeners", () => {
    expect(source).toMatch(/if \(event\.button !== 0\) return/)
    expect(source).toMatch(/removeEventListener\("pointermove", onMove\)/)
    expect(source).toMatch(/removeEventListener\("pointerup", onUp\)/)
  })

  test("stays free of banned patterns", () => {
    expect(source).not.toMatch(/setTimeout/)
    expect(source).not.toMatch(/MutationObserver/)
    expect(source).not.toMatch(/innerHTML/)
    expect(source).not.toMatch(/!important/)
    expect(source).not.toMatch(/:\s*any\b/)
    expect(source).not.toMatch(/TODO|FIXME/)
  })
})
