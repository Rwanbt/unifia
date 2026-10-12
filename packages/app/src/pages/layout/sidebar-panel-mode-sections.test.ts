/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

test("context panel: Code and Work are real, the other modes render what their surface publishes", async () => {
  const source = await Bun.file(new URL("./sidebar-panel-mode-sections.tsx", import.meta.url)).text()

  // Work's sections are real (ADR-040): the six views drive layout.work.
  expect(source).toContain('id="code.scope"')
  expect(source).toContain('id="work.views"')
  expect(source).toContain('id="work.agents"')
  expect(source).toContain("onClick={() => layout.work.setView(view)}")

  for (const destination of ["code", "work"]) {
    expect(source).toContain(`mode.destination() === "${destination}"`)
  }
  for (const destination of ["design", "automate", "browser", "memory"]) {
    expect(source).toContain(`"${destination}"`)
  }
  expect(source).toContain("navigation.read(props.mode)")
})

test("context panel keeps no demo rows: nothing names a workflow, page or link that does not exist", async () => {
  const source = await Bun.file(new URL("./sidebar-panel-mode-sections.tsx", import.meta.url)).text()

  for (const invented of ["Landing", "Components\"", "Issue triage", "Release notes", "Nightly tests", "StaticSection", 'badge: "3"']) {
    expect(source).not.toContain(invented)
  }
})
