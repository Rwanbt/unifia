/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { ModalBackGuard, type BackHistory } from "./modal-back"

function recorder() {
  const calls: string[] = []
  const history: BackHistory = {
    push: () => calls.push("push"),
    pop: () => calls.push("pop"),
  }
  return { calls, guard: new ModalBackGuard(history) }
}

describe("ModalBackGuard", () => {
  test("opening pushes exactly one history entry", () => {
    const { calls, guard } = recorder()
    guard.opened()
    guard.opened()
    expect(calls).toEqual(["push"])
  })

  test("a Back gesture consumes the entry and does not pop again", () => {
    const { calls, guard } = recorder()
    guard.opened()
    expect(guard.popped()).toBe(true)
    guard.closed()
    expect(calls).toEqual(["push"])
  })

  test("closing from the modal's own controls pops the entry it pushed", () => {
    const { calls, guard } = recorder()
    guard.opened()
    guard.closed()
    expect(calls).toEqual(["push", "pop"])
  })

  test("closing a modal that never opened leaves history alone", () => {
    const { calls, guard } = recorder()
    guard.closed()
    expect(calls).toEqual([])
    expect(guard.popped()).toBe(false)
  })

  test("reopening after a Back gesture pushes a fresh entry", () => {
    const { calls, guard } = recorder()
    guard.opened()
    guard.popped()
    guard.opened()
    expect(calls).toEqual(["push", "push"])
  })

  test("a delayed popstate from a close does not close a fast reopen", () => {
    const { calls, guard } = recorder()
    guard.opened()
    guard.closed()
    guard.opened()
    // The handler consumes the delayed event before consulting popped(), so the
    // entry pushed by the reopen stays tracked and a real Back still closes it.
    expect(guard.pendingPop()).toBe(true)
    expect(guard.popped()).toBe(true)
    expect(calls).toEqual(["push", "pop", "push"])
  })

  test("the delayed popstate is consumed even when the dialog stayed closed", () => {
    const { guard } = recorder()
    guard.opened()
    guard.closed()
    expect(guard.pendingPop()).toBe(true)
    guard.opened()
    expect(guard.popped()).toBe(true)
  })

  test("two fast close-and-reopen cycles consume both delayed popstates", () => {
    const { guard } = recorder()
    guard.opened()
    guard.closed()
    guard.opened()
    guard.closed()
    guard.opened()
    expect(guard.pendingPop()).toBe(true)
    expect(guard.pendingPop()).toBe(true)
    expect(guard.pendingPop()).toBe(false)
    expect(guard.popped()).toBe(true)
  })
})
