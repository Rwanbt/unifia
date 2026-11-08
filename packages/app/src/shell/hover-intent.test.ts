/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createHoverIntent, createHoverPeek, HOVER_CLOSE_DELAY, HOVER_OPEN_DELAY } from "./hover-intent"

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

  test("HoverIntent_TravelGapShorterThanCloseDelay_StaysOpen", async () => {
    const { intent, isOpen } = panel()
    intent.enterTrigger(mouse)
    await wait(15)
    intent.leaveTrigger()
    await wait(8)
    intent.enterPanel()
    await wait(30)
    expect(isOpen()).toBe(true)
  })

  test("HoverIntent_LeavingThePanel_ClosesOnlyAfterTheDelay", async () => {
    const { intent, isOpen } = panel()
    intent.enterTrigger(mouse)
    await wait(15)
    intent.leaveTrigger()
    intent.enterPanel()
    intent.leavePanel()
    await wait(8)
    expect(isOpen()).toBe(true)
    await wait(25)
    expect(isOpen()).toBe(false)
  })

  test("HoverIntent_ReenterTrigger_CancelsTheClose", async () => {
    const { intent, isOpen } = panel()
    intent.enterTrigger(mouse)
    await wait(15)
    intent.leaveTrigger()
    await wait(8)
    intent.enterTrigger(mouse)
    await wait(30)
    expect(isOpen()).toBe(true)
  })
})

describe("createHoverPeek", () => {
  const peek = () => createRoot(() => createHoverPeek(10, 20))

  test("HoverPeek_LeavingTheTrigger_DoesNotCollapseBeforeTheDelay", async () => {
    const rail = peek()
    rail.enterTrigger(mouse)
    await wait(15)
    expect(rail.active()).toBe(true)
    rail.leaveTrigger()
    expect(rail.active()).toBe(true)
    rail.enterPanel()
    await wait(30)
    expect(rail.active()).toBe(true)
    rail.leavePanel()
    await wait(30)
    expect(rail.active()).toBe(false)
  })

  test("HoverPeek_EnteringThePanelWhileClosed_DoesNotOpen", async () => {
    const rail = peek()
    rail.enterPanel()
    await wait(15)
    expect(rail.active()).toBe(false)
  })

  test("HoverPeek_Cancel_ClosesAtOnce", async () => {
    const rail = peek()
    rail.enterTrigger(mouse)
    await wait(15)
    rail.cancel()
    expect(rail.active()).toBe(false)
  })
})
