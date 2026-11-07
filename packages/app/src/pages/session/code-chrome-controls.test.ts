/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text()

// Owner request 2026-11-07: the Code panel keeps only controls that work.
describe("Code mode chrome", () => {
  test("the codebar no longer renders Symbols, Split or Commands", async () => {
    const editor = await read("./session-editor-surface.tsx")
    expect(editor).toContain('data-v110="code-permission-chip"')
    expect(editor).not.toContain('data-v110="code-bar-button"')
    for (const key of ["editor.codebar.symbols", "editor.codebar.split", "editor.codebar.commands"]) {
      expect(editor).not.toContain(key)
    }
  })

  test("the terminal renders no disabled placeholder controls", async () => {
    const chrome = await read("./terminal-panel-chrome.tsx")
    expect(chrome).not.toContain("aria-disabled")
    for (const key of ["terminal.tools.split", "terminal.tools.agent", "terminal.panel.more", "terminal.panel.ports"]) {
      expect(chrome).not.toContain(key)
    }
    for (const key of ["terminal.tools.new", "terminal.tools.rename", "terminal.tools.kill", "terminal.clear"]) {
      expect(chrome).toContain(key)
    }
  })
})
