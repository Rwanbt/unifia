/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createExitHold } from "../../src/pages/session/exit-hold"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function setup(initial: boolean, reduced = false) {
  return createRoot((dispose) => {
    const [visible, setVisible] = createSignal(initial)
    const mounted = createExitHold(visible, 40, () => reduced)
    return { mounted, setVisible, dispose }
  })
}

describe("createExitHold", () => {
  test("ExitHold_Hide_StaysMountedDuringExitThenUnmounts", async () => {
    const hold = setup(true)
    hold.setVisible(false)
    await wait(10)
    expect(hold.mounted()).toBe(true)
    await wait(60)
    expect(hold.mounted()).toBe(false)
    hold.dispose()
  })

  test("ExitHold_ShowDuringExit_StaysMounted", async () => {
    const hold = setup(true)
    hold.setVisible(false)
    await wait(10)
    hold.setVisible(true)
    await wait(60)
    expect(hold.mounted()).toBe(true)
    hold.dispose()
  })

  test("ExitHold_Show_MountsImmediately", () => {
    const hold = setup(false)
    expect(hold.mounted()).toBe(false)
    hold.setVisible(true)
    expect(hold.mounted()).toBe(true)
    hold.dispose()
  })

  test("ExitHold_ReducedMotion_UnmountsAtOnce", () => {
    const hold = setup(true, true)
    hold.setVisible(false)
    expect(hold.mounted()).toBe(false)
    hold.dispose()
  })
})
