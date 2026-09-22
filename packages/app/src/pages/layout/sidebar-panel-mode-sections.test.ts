/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

test("context panel dispatches the maquette sections for every workspace mode", async () => {
  const source = await Bun.file(new URL("./sidebar-panel-mode-sections.tsx", import.meta.url)).text()

  expect(source).toContain('data-mode-section="code.scope"')

  for (const section of [
    "work.views",
    "work.agents",
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
