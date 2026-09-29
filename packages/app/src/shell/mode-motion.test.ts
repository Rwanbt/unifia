/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import { withModeMotion } from "./mode-motion"

describe("withModeMotion", () => {
  afterEach(() => {
    delete document.documentElement.dataset.uiAnimations
  })

  test("ModeMotion_AnimationsOff_RunsTheChangeWithoutGhosts", () => {
    document.documentElement.dataset.uiAnimations = "off"
    let changed = 0
    withModeMotion(() => changed++)
    expect(changed).toBe(1)
    expect(document.body.querySelector('[aria-hidden="true"][inert]')).toBeNull()
  })
})
