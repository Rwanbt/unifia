/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createHoverIntent, HOVER_CLOSE_DELAY, HOVER_OPEN_DELAY } from "./hover-intent"

const mouse = { pointerType: "mouse" } as PointerEvent
const touch = { pointerType: "touch" } as PointerEvent
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function panel() {
  let open = false
  const intent = createHoverIntent({ open: () => (open = true), close: () => (open = false), isOpen: () => open, openDelay: 10, closeDelay: 20 })
  return { intent, isOpen: () => open, setOpen: (value: boolean) => (open = value) }
}

describe("createHoverIntent", () => {
  test("HoverIntent_Defaults_MatchTheReference", () => {
    expect(HOVER_OPEN_DELAY).toBe(190)
    expect(HOVER_CLOSE_DELAY).toBe(360)
  })

  test("HoverIntent_RestOnTrigger_OpensThenClosesAfterLeaving", async () => {
    const { intent, isOpen } = panel()
    intent.enterTrigger(mouse)
    await wait(15)
    expect(isOpen()).toBe(true)
    intent.leaveTrigger()
    await wait(30)
    expect(isOpen()).toBe(false)
  })

  test("HoverIntent_PassOverTrigger_DoesNotOpen", async () => {
    const { intent, isOpen } = panel()
    intent.enterTrigger(mouse)
    intent.leaveTrigger()
    await wait(15)
    expect(isOpen()).toBe(false)
  })

  test("HoverIntent_PointerMovesIntoPanel_StaysOpen", async () => {
    const { intent, isOpen } = panel()
    intent.enterTrigger(mouse)
    await wait(15)
    intent.leaveTrigger()
    intent.enterPanel()
    await wait(30)
    expect(isOpen()).toBe(true)
  })

  test("HoverIntent_Pinned_IgnoresThePointer", async () => {
    const { intent, isOpen } = panel()
    intent.enterTrigger(mouse)
    await wait(15)
    intent.pin()
    intent.leaveTrigger()
    await wait(30)
    expect(isOpen()).toBe(true)
  })

  test("HoverIntent_Touch_NeverPeeks", async () => {
    const { intent, isOpen } = panel()
    intent.enterTrigger(touch)
    await wait(15)
    expect(isOpen()).toBe(false)
  })

  test("HoverIntent_AlreadyOpenByClick_IsNotClosedByLeaving", async () => {
    const { intent, isOpen, setOpen } = panel()
    setOpen(true)
    intent.enterTrigger(mouse)
    intent.leaveTrigger()
    await wait(30)
    expect(isOpen()).toBe(true)
  })
})
