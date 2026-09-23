/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

test("Code and Memory inspect the note the session has attached, like the reference", async () => {
  const source = await Bun.file(new URL("./mode-inspector-content.tsx", import.meta.url)).text()

  expect(source).toContain("code: NOTE_CARDS")
  expect(source).toContain("memory: NOTE_CARDS")
  expect(source).not.toContain("CODE_INSPECTOR_TABS")
})

test("inspector content follows the active workspace destination", async () => {
  const source = await Bun.file(new URL("./mode-inspector-content.tsx", import.meta.url)).text()
  const sidePanel = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()

  for (const destination of ["code", "work", "design", "automate", "browser", "memory", "settings", "user"]) {
    expect(source).toContain(`${destination}:`)
  }

  for (const marker of ["data-mode-inspector", "data-mode-execution"]) {
    expect(source).toContain(marker)
  }

  // Explorer is the live project tree in every mode, like the reference.
  expect(sidePanel).toContain('<Match when={layout.inspector.tab() === "explorer"}>')
  expect(sidePanel).not.toContain("ModeExplorerSurface")
  expect(sidePanel).toContain("<ModeInspectorSurface mode={destination()} />")
  expect(sidePanel).toContain("<ModeExecutionSurface mode={destination()} events={executionEvents()} />")
})

test("InspectorFrame mirrors the reference head, three tabs, and one content stage", async () => {
  const source = await Bun.file(new URL("../../shell/v110-inspector-frame.tsx", import.meta.url)).text()
  const css = await Bun.file(new URL("../../styles/v110-inspector.css", import.meta.url)).text()

  expect(source).toContain('data-v110="inspector-head"')
  expect(source).toContain('data-v110="inspector-title"')
  expect(source).toContain('role="tablist"')
  expect(source).toContain('data-v110="inspector-tabs"')
  expect(source).toContain('id="v110-inspector-panel" role="tabpanel"')
  expect(source.match(/role="tab"/g)?.length).toBe(1)
  expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))")
  expect(css).toContain("height: 37px")
  expect(css).toContain('[data-v110="inspector-frame"] > [role="tabpanel"]')
})

test("inspector cards expose the maquette card and row contracts", async () => {
  const source = await Bun.file(new URL("./mode-inspector-content.tsx", import.meta.url)).text()
  const css = await Bun.file(new URL("../../styles/v110-inspector.css", import.meta.url)).text()

  expect(source).toContain("data-inspector-card")
  expect(source).toContain("data-inspector-row")
  expect(source).toContain('data-inspector-state="default"')
  expect(css).toContain('[data-v110="inspector-content"] [data-inspector-card]')
  expect(css).toContain("border-radius: 13px")
})

test("Execution lists the session's events under the reference's filter grid", async () => {
  const source = await Bun.file(new URL("./mode-inspector-content.tsx", import.meta.url)).text()
  const css = await Bun.file(new URL("../../styles/v110-inspector.css", import.meta.url)).text()

  expect(source).toContain("<For each={EXECUTION_FILTERS}>")
  expect(source).toContain("data-execution-filter={item}")
  expect(source).toContain("data-execution-row")
  expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))")
  expect(css).toContain("grid-template-columns: 42px 20px minmax(0, 1fr)")
})
