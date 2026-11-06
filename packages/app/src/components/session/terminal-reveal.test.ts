/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { layoutShowingTerminal } from "./terminal-reveal"

describe("layoutShowingTerminal", () => {
  test("Chat on a wide screen opens Split, where the terminal is visible", () => {
    expect(layoutShowingTerminal("chat", ["chat", "split", "main"])).toBe("split")
  })
  test("Chat on a phone, which has no Split, opens the Editor", () => {
    expect(layoutShowingTerminal("chat", ["chat", "main"])).toBe("main")
  })
  test("Split and Editor already show the terminal: nothing changes", () => {
    expect(layoutShowingTerminal("split", ["chat", "split", "main"])).toBeUndefined()
    expect(layoutShowingTerminal("main", ["chat", "main"])).toBeUndefined()
  })
})
