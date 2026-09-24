/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

test("Memory inspects the attached note; Code gets the seven-tool code inspector (ADR-049)", async () => {
  const source = await Bun.file(new URL("./mode-inspector-content.tsx", import.meta.url)).text()
  const sidePanel = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()
  const codeInspector = await Bun.file(new URL("./code-inspector/code-inspector.tsx", import.meta.url)).text()

  expect(source).toContain("memory: NOTE_CARDS")
  expect(sidePanel).toContain('layout.inspector.tab() === "inspector" && destination() === "code"')
  expect(codeInspector).toContain('["overview", "symbols", "search", "review", "git", "context", "history"]')
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
  expect(sidePanel).toContain("<ModeExecutionSurface")
  // A pending resource read would suspend inside a mode switch's route
  // transition and block the navigation.
  expect(sidePanel).toContain('events={executionEvents.state === "ready" ? executionEvents() : undefined}')
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
