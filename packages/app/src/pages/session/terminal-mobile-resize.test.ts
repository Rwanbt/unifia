/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { clampMobileTerminalHeight, mobileTerminalDragHeight } from "./terminal-mobile-resize"

describe("mobile terminal resize", () => {
  test("dragging up grows the terminal and dragging down shrinks it", () => {
    expect(mobileTerminalDragHeight(220, 300, 260, 400)).toBe(65)
    expect(mobileTerminalDragHeight(220, 300, 340, 400)).toBe(45)
  })

  test("mobile panel keeps room for its controls and terminal", async () => {
    const css = await Bun.file(new URL("../../../../mobile/src/mobile.css", import.meta.url)).text()
    expect(css).toContain("min-height: min(240px, calc(100% - 16px))")
  })

  test("drag and keyboard sizes stay inside their bounds", () => {
    expect(mobileTerminalDragHeight(220, 300, -500, 400)).toBe(95)
    expect(mobileTerminalDragHeight(220, 300, 900, 400)).toBe(20)
    expect(clampMobileTerminalHeight(100)).toBe(95)
    expect(clampMobileTerminalHeight(0)).toBe(20)
  })
})
