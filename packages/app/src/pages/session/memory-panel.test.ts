/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Phase 9 (Memory mobile single-pane) - static smoke test. The panel is
// not renderable in this package's test setup, so the responsive wiring
// is pinned at the source level: the canonical viewport authority drives
// the single-pane mode, tap-to-navigate switches panes, and no local CSS
// breakpoint hides a pane behind the user's back.

const SOURCE = resolve(import.meta.dir, "memory-panel.tsx")
const source = readFileSync(SOURCE, "utf8")

describe("MemoryPanel mobile single-pane (Phase 9)", () => {
  test("reads the canonical viewport authority", () => {
    expect(source).toMatch(/import\s+\{\s*useViewport\s*\}\s+from\s+"@\/shell\/v110-store"/)
    expect(source).toMatch(
      /family === "phone-portrait" \|\| family === "tablet-portrait" \|\| family === "compact-landscape"/,
    )
  })

  test("collapses the triptych to one visible pane via data-memory-layout", () => {
    expect(source).toMatch(/data-memory-layout=\{narrow\(\) \? "single" : "triptych"\}/)
    expect(source).toMatch(/classList=\{\{ hidden: narrow\(\) && mobilePane\(\) !== "vault" \}\}/)
    expect(source).toMatch(/classList=\{\{ hidden: narrow\(\) && mobilePane\(\) !== "note" \}\}/)
    expect(source).toMatch(/classList=\{\{ hidden: narrow\(\) && mobilePane\(\) !== "links" \}\}/)
  })

  test("tap-to-navigate selects a note and switches to the note pane", () => {
    expect(source).toMatch(/setSelectedPath\(item\.path\); setMobilePane\("note"\)/)
    expect(source).toMatch(/setSelectedPath\(node\.path\); setMobilePane\("note"\)/)
  })

  test("exposes back navigation between panes", () => {
    expect(source).toMatch(/data-memory-back-to-vault/)
    expect(source).toMatch(/data-memory-open-links/)
    expect(source).toMatch(/data-memory-back-to-note/)
  })

  test("narrow viewports do not auto-select the first note", () => {
    expect(source).toMatch(/if \(narrow\(\)\) return/)
  })

  test("no local CSS breakpoint hides a pane (viewport authority wins)", () => {
    expect(source).not.toMatch(/max-\[620px\]/)
    expect(source).not.toMatch(/max-\[900px\]/)
  })
})