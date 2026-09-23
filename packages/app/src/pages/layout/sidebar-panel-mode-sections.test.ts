/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

test("context panel dispatches the maquette sections for every workspace mode", async () => {
  const source = await Bun.file(new URL("./sidebar-panel-mode-sections.tsx", import.meta.url)).text()

  // Work's sections are real (ADR-040): the six views drive layout.work.
  expect(source).toContain('id="code.scope"')
  expect(source).toContain('id="work.views"')
  expect(source).toContain('id="work.agents"')
  expect(source).toContain("onClick={() => layout.work.setView(view)}")

  for (const section of [
    "design.pages",
    "design.system",
    "automate.workflows",
    "automate.runs",
    "browser.links",
    "browser.library",
    "memory.memory",
  ]) {
    expect(source).toContain(`id="${section}"`)
  }

  for (const destination of ["code", "work", "design", "automate", "browser", "memory"]) {
    expect(source).toContain(`mode.destination() === "${destination}"`)
  }
})
