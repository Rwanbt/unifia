/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { doc, rect } from "./fixtures"
import {
  emptyDesignHistory,
  recordDesignHistory,
  redoDesignHistory,
  undoDesignHistory,
  type DesignHistoryState,
} from "./history"

describe("design history", () => {
  test("undo restores the previous document and redo returns to the current one", () => {
    const first = doc([rect("a")])
    const second = doc([rect("a"), rect("b")])
    const recorded = recordDesignHistory(emptyDesignHistory, first)
    const undone = undoDesignHistory(recorded, second)
    expect(undone).toBeDefined()
    if (!undone) return
    expect(undone.document).toBe(first)
    const redone = redoDesignHistory(undone.state, undone.document)
    expect(redone).toBeDefined()
    if (!redone) return
    expect(redone.document).toBe(second)
  })

  test("undo and redo are no-ops on an empty edge", () => {
    const current = doc([rect("a")])
    expect(undoDesignHistory(emptyDesignHistory, current)).toBeUndefined()
    expect(redoDesignHistory(emptyDesignHistory, current)).toBeUndefined()
  })

  test("a new record clears the redo branch", () => {
    const first = doc([rect("a")])
    const second = doc([rect("a"), rect("b")])
    const third = doc([rect("c")])
    const undone = undoDesignHistory(recordDesignHistory(emptyDesignHistory, first), second)
    expect(undone).toBeDefined()
    if (!undone) return
    expect(undone.state.future).toHaveLength(1)
    const branched = recordDesignHistory(undone.state, first)
    expect(branched.future).toEqual([])
    const redone = redoDesignHistory(branched, third)
    expect(redone).toBeUndefined()
  })

  test("the past stack is capped at the limit", () => {
    let history: DesignHistoryState = emptyDesignHistory
    for (let index = 0; index < 4; index += 1) {
      history = recordDesignHistory(history, doc([rect(`r${index}`)]), 2)
    }
    expect(history.past).toHaveLength(2)
  })
})
