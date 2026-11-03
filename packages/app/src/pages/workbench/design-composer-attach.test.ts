/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { appendToPrompt, formatCommentForComposer } from "./design-composer-format"
import { designTabLabel } from "./design-tabs"

describe("design comment → composer", () => {
  test("formats the target and the note", () => {
    expect(formatCommentForComposer({ elementId: "hero", note: " Bigger title " }, "index.html")).toBe(
      "[Design · index.html · #hero] Bigger title",
    )
  })
  test("fills an empty draft", () => {
    const next = appendToPrompt([{ type: "text", content: "", start: 0, end: 0 }], "a")
    expect(next).toEqual([{ type: "text", content: "a", start: 0, end: 1 }])
  })
  test("appends on a new line after existing text", () => {
    const next = appendToPrompt([{ type: "text", content: "fix this ", start: 0, end: 9 }], "b")
    expect(next).toEqual([{ type: "text", content: "fix this\nb", start: 0, end: 10 }])
  })
  test("adds a text part after a non-text part", () => {
    const next = appendToPrompt([{ type: "file", path: "x.ts", content: "@x.ts", start: 0, end: 5 }], "c")
    expect(next[1]).toEqual({ type: "text", content: "c", start: 5, end: 6 })
  })
})

describe("designTabLabel", () => {
  const t = (key: string) => `T(${key})`
  test("built-in tabs follow the locale", () => {
    expect(designTabLabel({ id: "files", title: "Fichiers" }, t)).toBe("T(design.workspace.tab.files)")
    expect(designTabLabel({ id: "terminal", title: "Terminal" }, t)).toBe("T(design.studio.workshop.terminal)")
  })
  test("artifact tabs keep their own title", () => {
    expect(designTabLabel({ id: "art-1", title: "landing.html" }, t)).toBe("landing.html")
  })
})
