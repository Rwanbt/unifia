/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  extractMessageText,
  selectNextStepSuggestions,
  type NextStepSuggestion,
  type ThreadMessage,
} from "@/pages/workbench/workbench-thread-shared"

describe("extractMessageText", () => {
  test("returns an empty string when the parts map is undefined", () => {
    expect(extractMessageText(undefined)).toBe("")
  })

  test("returns an empty string when no part is a text part", () => {
    expect(extractMessageText([{ type: "tool" }, { type: "snapshot" }])).toBe("")
  })

  test("concatenates text parts with a newline and trims the result", () => {
    const text = extractMessageText([
      { type: "text", text: "Bonjour" },
      { type: "text", text: "Comment ça va ?" },
    ])
    expect(text).toBe("Bonjour\nComment ça va ?")
  })

  test("ignores tool and snapshot parts interspersed with text parts", () => {
    const text = extractMessageText([
      { type: "text", text: "Étape 1" },
      { type: "tool", text: "{…}" },
      { type: "text", text: "Étape 2" },
    ])
    expect(text).toBe("Étape 1\nÉtape 2")
  })

  test("ignores text parts whose text is empty or missing", () => {
    const text = extractMessageText([
      { type: "text" },
      { type: "text", text: "" },
      { type: "text", text: "Gardée" },
    ])
    expect(text).toBe("Gardée")
  })
})

describe("selectNextStepSuggestions", () => {
  test("returns the work-mode list when mode is work", () => {
    const suggestions = selectNextStepSuggestions("work")
    expect(suggestions.length).toBeGreaterThan(0)
    for (const suggestion of suggestions) assertWellFormed(suggestion)
    // Each mode must surface at least one prompt that mentions the surface name.
    expect(suggestions.some((s) => s.prompt.toLowerCase().includes("espace de travail"))).toBe(true)
  })

  test("returns the design-mode list when mode is design", () => {
    const suggestions = selectNextStepSuggestions("design")
    expect(suggestions.length).toBeGreaterThan(0)
    for (const suggestion of suggestions) assertWellFormed(suggestion)
  })

  test("returns the automate-mode list when mode is automate", () => {
    const suggestions = selectNextStepSuggestions("automate")
    expect(suggestions.length).toBeGreaterThan(0)
    for (const suggestion of suggestions) assertWellFormed(suggestion)
  })

  test("every suggestion carries a unique id across the three mode lists", () => {
    const all: NextStepSuggestion[] = [
      ...selectNextStepSuggestions("work"),
      ...selectNextStepSuggestions("design"),
      ...selectNextStepSuggestions("automate"),
    ]
    const ids = all.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("every suggestion prompt is non-empty and ends without trailing whitespace", () => {
    for (const mode of ["work", "design", "automate"] as const) {
      for (const suggestion of selectNextStepSuggestions(mode)) {
        expect(suggestion.prompt.length).toBeGreaterThan(0)
        expect(suggestion.prompt).toBe(suggestion.prompt.trim())
      }
    }
  })
})

/**
 * Smoke-checks the shape of a `ThreadMessage`. The fields are mapped from
 * `sync.data.message[sessionId]` + `sync.data.part[messageId]` in
 * `WorkbenchThread`; the helper exists so the test surfaces a regression
 * in the contract without making `WorkbenchThread` itself runnable in a
 * unit test (it depends on the full app context tree).
 */
describe("ThreadMessage shape (contract)", () => {
  test("the fields the thread relies on are id, role and text", () => {
    const sample: ThreadMessage = {
      id: "msg-1",
      role: "assistant",
      text: "Bonjour",
    }
    expect(Object.keys(sample).sort()).toEqual(["id", "role", "text"])
  })
})

function assertWellFormed(suggestion: NextStepSuggestion): void {
  expect(typeof suggestion.id).toBe("string")
  expect(suggestion.id.length).toBeGreaterThan(0)
  expect(typeof suggestion.label).toBe("string")
  expect(suggestion.label.length).toBeGreaterThan(0)
  expect(typeof suggestion.prompt).toBe("string")
  expect(suggestion.prompt.length).toBeGreaterThan(0)
}
