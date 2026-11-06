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
})
