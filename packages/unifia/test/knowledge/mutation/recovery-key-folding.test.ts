/* SPDX-License-Identifier: MIT */
/**
 * The recovery key folds case only where the platform folds it. Pure, so it runs on every platform.
 */

import { describe, it, expect } from "bun:test"
import { recoveryKey } from "../../../src/knowledge/mutation/durability.js"

describe("recovery names a note by its key", () => {
  it("names that differ only in case are one note where the platform folds case, and two notes where it does not", () => {
    expect(recoveryKey("Notes/a.md", true)).toBe(recoveryKey("notes/a.md", true))
    expect(recoveryKey("Notes/a.md", false)).not.toBe(recoveryKey("notes/a.md", false))
  })
})
