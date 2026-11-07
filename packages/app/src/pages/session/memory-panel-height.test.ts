/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"

// The memory panel is a flex column; the triptych grid must fill it and give
// its single row the full height, or the vault/links panes stop short.
test("the memory triptych grid fills the panel height", async () => {
  const css = await Bun.file(new URL("../../styles/v110-memory.css", import.meta.url)).text()
  const block = css.match(/\n\[data-v110="memory-grid"\] \{([^}]*)\}/)?.[1] ?? ""
  expect(block).toMatch(/flex:\s*1 1 auto;/)
  expect(block).toMatch(/min-height:\s*0;/)
  expect(block).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\);/)
  const panel = css.match(/\n\[data-v110="memory-panel"\] \{([^}]*)\}/)?.[1] ?? ""
  expect(panel).toMatch(/flex-direction:\s*column;/)
  expect(panel).toMatch(/height:\s*100%;/)
})
