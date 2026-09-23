/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

test("Code Inspector stays focused on session metadata", async () => {
  const source = await Bun.file(new URL("./mode-inspector-content.tsx", import.meta.url)).text()

  expect(source).toContain('title: "Session"')
  expect(source).not.toContain('title: "Sliders du thème"')
  expect(source).not.toContain('"Density", "Radius", "Contrast"')
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
  expect(sidePanel).toContain("<ModeExecutionSurface mode={destination()} sessionId={props.sessionId} />")
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
  expect(css).toContain("border-radius: 11px")
})

test("Code Inspector exposes the reference sub-navigation and Execution exposes all filters", async () => {
  const source = await Bun.file(new URL("./mode-inspector-content.tsx", import.meta.url)).text()

  for (const label of ["Overview", "Symbols", "Search", "Review", "Git", "Context", "History"]) {
    expect(source).toContain(`"${label}"`)
  }

  expect(source.match(/const EXECUTION_FILTERS =/g)?.length).toBe(1)
  expect(source).toContain('"Tout", "Modèle", "Contexte", "Outils", "Sources", "Skills", "Mémoire", "Agents", "Règles", "Interaction", "Usage"')
  expect(source).toContain('data-inspector-nav="code"')
  expect(source).toContain("data-execution-filters")
  expect(source).toContain("data-execution-filter={filter.toLowerCase()}")
  const css = await Bun.file(new URL("../../styles/v110-inspector.css", import.meta.url)).text()
  expect(css).toContain("overflow-x: auto")
  expect(css).toContain("[data-v110=\"inspector-content\"] [data-execution-filter]")
  expect(css).toContain("flex: 0 0 auto")
  expect(css).not.toContain("grid-template-columns: repeat(2")
})
