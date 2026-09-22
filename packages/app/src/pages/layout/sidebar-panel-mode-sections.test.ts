/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

test("context panel dispatches the maquette sections for every workspace mode", async () => {
  const source = await Bun.file(new URL("./sidebar-panel-mode-sections.tsx", import.meta.url)).text()

  expect(source).toContain('data-mode-section="code.scope"')
  // Work's sections are real (ADR-040): the six views drive layout.work.
  expect(source).toContain('data-mode-section="work.views"')
  expect(source).toContain('data-mode-section="work.agents"')
  expect(source).toContain("onClick={() => layout.work.setView(view)}")

  for (const section of [
    "design.files",
    "design.assets",
    "automate.workflows",
    "automate.runs",
    "browser.links",
    "browser.library",
    "memory.navigation",
    "memory.shortcuts",
  ]) {
    expect(source).toContain(`testId="${section}"`)
  }

  for (const destination of ["code", "work", "design", "automate", "browser", "memory"]) {
    expect(source).toContain(`mode.destination() === "${destination}"`)
  }
})
