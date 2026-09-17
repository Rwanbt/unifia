/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SOURCE = resolve(import.meta.dir, "automate-studio-environment.tsx")
const source = readFileSync(SOURCE, "utf8")

describe("AutomateStudioEnvironment smoke test (static)", () => {
  test("exports the SolidJS component", () => {
    expect(source).toMatch(/export\s+function\s+AutomateStudioEnvironment\s*\(/)
  })

  test("exports a CAPABILITY_CATALOGUE that covers the runtime grants the surface relies on", () => {
    // Anti-regression: a future refactor that drops one of these
    // capability keys would break the runtime-gate contract (e.g.
    // workflow.run is the single gate for the Automate rail per
    // ADR-1041).
    expect(source).toMatch(/CAPABILITY_CATALOGUE/)
    for (const key of [
      "workflow.run",
      "workflow.publish",
      "design.create",
      "design.write",
      "workspace.read",
      "workspace.write",
      "approval.read",
      "approval.write",
      "trace.read",
    ]) {
      expect(source).toContain(`key: "${key}"`)
    }
  })

  test("surfaces workspace id + grants + approvals + runs", () => {
    expect(source).toMatch(/data-automate-studio-environment-workspace/)
    expect(source).toMatch(/data-automate-studio-environment-section="capabilities"/)
    expect(source).toMatch(/data-automate-studio-environment-section="approvals"/)
    expect(source).toMatch(/data-automate-studio-environment-section="runs"/)
  })

  test("distinguishes active from inactive capabilities via data-attribute", () => {
    expect(source).toMatch(/data-automate-studio-environment-capability-active="true"/)
    expect(source).toMatch(/data-automate-studio-environment-capability-active="false"/)
  })

  test("emits an empty-state hint when there are no pending approvals or runs", () => {
    expect(source).toMatch(/data-automate-studio-environment-approvals-empty/)
    expect(source).toMatch(/data-automate-studio-environment-runs-empty/)
  })

  test("exposes onCancelRun for the Phase 9.2 branches wiring", () => {
    // Anti-regression: a future refactor that removes the
    // onCancelRun prop breaks the Phase 9.2 branches slice before
    // it ships.
    expect(source).toMatch(/readonly\s+onCancelRun\?/)
    expect(source).toMatch(/data-automate-studio-environment-run-cancel/)
  })
})
