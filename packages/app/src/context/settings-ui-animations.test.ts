/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { uiAnimationsValue } from "./settings"

// v110 Motion contract (INTERACTIONS.md): the <html data-ui-animations>
// attribute is what the shell stylesheet keys on to stop every animation
// and transition, independently of prefers-reduced-motion (which is CSS).

describe("uiAnimationsValue (v110 motion contract)", () => {
  test("maps an enabled preference to the on attribute value", () => {
    expect(uiAnimationsValue(true)).toBe("on")
  })

  test("maps a disabled preference to the off attribute value", () => {
    expect(uiAnimationsValue(false)).toBe("off")
  })
})