/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { OperationRegistry } from "../src/operations.js"

describe("operation registry", () => {
  test("deduplicates idempotent starts and cancels active work", () => {
    let sequence = 0
    const registry = new OperationRegistry(() => `op-${++sequence}`, () => 100)
    const first = registry.start("workspace", "session", "request-1")
    const duplicate = registry.start("workspace", "session", "request-1")
    expect(duplicate.id).toBe(first.id)
    expect(registry.cancel(first.id)?.state).toBe("cancelled")
    expect(registry.complete(first.id)?.state).toBe("cancelled")
  })

  test("does not cancel completed work", () => {
    const registry = new OperationRegistry(() => "op-1")
    const operation = registry.start("workspace", "session")
    registry.complete(operation.id)
    expect(registry.cancel(operation.id)).toBeUndefined()
  })
})
