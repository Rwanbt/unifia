/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { validateDefinition } from "./automate-studio-run-bar"

const SOURCE = resolve(import.meta.dir, "automate-studio-run-bar.tsx")
const source = readFileSync(SOURCE, "utf8")

describe("AutomateStudioRunBar smoke test (static)", () => {
  test("exports the SolidJS component", () => {
    expect(source).toMatch(/export\s+function\s+AutomateStudioRunBar\s*\(/)
  })

  test("renders the state chip + data attribute for tests", () => {
    expect(source).toMatch(/data-automate-studio-run-bar-state/)
    expect(source).toMatch(/data-state-value=\{props\.state\}/)
  })

  test("renders all 5 actions when appropriate", () => {
    expect(source).toMatch(/data-automate-studio-run-bar-action="validate"/)
    expect(source).toMatch(/data-automate-studio-run-bar-action="start"/)
    expect(source).toMatch(/data-automate-studio-run-bar-action="allow"/)
    expect(source).toMatch(/data-automate-studio-run-bar-action="deny"/)
    expect(source).toMatch(/data-automate-studio-run-bar-action="cancel"/)
  })

  test("only shows Allow/Deny/Cancel when state is waiting-approval", () => {
    // Anti-regression: a future refactor that always renders the
    // approval buttons would clutter the UI when the workflow is
    // idle or running.
    expect(source).toMatch(/<Show when=\{canApprove\(\)\}>/)
  })

  test("exposes a dismiss button when an error is present", () => {
    expect(source).toMatch(/data-automate-studio-run-bar-dismiss/)
  })

  test("renders the validate report (lines + ok flag)", () => {
    expect(source).toMatch(/data-automate-studio-run-bar-validate/)
    expect(source).toMatch(/data-automate-studio-run-bar-validate-line=/)
  })
})

describe("validateDefinition (pure)", () => {
  test("returns an error for invalid JSON", () => {
    const report = validateDefinition("not json")
    expect(report.ok).toBe(false)
    expect(report.lines.some((line) => line.message.startsWith("Invalid JSON"))).toBe(true)
  })

  test("returns errors when required fields are missing", () => {
    const report = validateDefinition(JSON.stringify({ steps: [] }))
    expect(report.ok).toBe(false)
    expect(report.lines.some((line) => line.message.includes('"id"'))).toBe(true)
    expect(report.lines.some((line) => line.message.includes('Unsupported version'))).toBe(true)
  })

  test("flags empty steps with a warning (not an error)", () => {
    const source = JSON.stringify({ id: "wf-1", version: 1, steps: [] })
    const report = validateDefinition(source)
    expect(report.ok).toBe(true) // warnings don't fail the report
    expect(report.lines.some((line) => line.severity === "warning" && line.message.includes("no steps"))).toBe(true)
  })

  test("flags steps with neither family nor capability", () => {
    const source = JSON.stringify({
      id: "wf-1",
      version: 1,
      steps: [{ id: "s-1" }],
    })
    const report = validateDefinition(source)
    expect(report.ok).toBe(true) // warnings don't fail the report
    expect(report.lines.some((line) => line.severity === "warning" && line.message.includes("Step #1"))).toBe(true)
  })

  test("returns ok=true on a clean definition", () => {
    const source = JSON.stringify({
      id: "wf-1",
      version: 1,
      steps: [
        { id: "s-1", family: "tool.http", capability: "http.get" },
        { id: "s-2", family: "tool.transform" },
      ],
    })
    const report = validateDefinition(source)
    expect(report.ok).toBe(true)
    expect(report.lines).toHaveLength(0)
  })

  test("flags a non-object step", () => {
    const source = JSON.stringify({ id: "wf-1", version: 1, steps: ["not-an-object"] })
    const report = validateDefinition(source)
    expect(report.ok).toBe(false)
    expect(report.lines.some((line) => line.severity === "error" && line.message.includes("not an object"))).toBe(true)
  })
})
