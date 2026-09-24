/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { toggledChapter } from "./session-chapters"

describe("toggledChapter", () => {
  test("ToggledChapter_NewMessage_AppendsIt", () => {
    expect(toggledChapter(["a"], "b")).toEqual(["a", "b"])
  })

  test("ToggledChapter_PinnedMessage_RemovesIt", () => {
    expect(toggledChapter(["a", "b"], "a")).toEqual(["b"])
  })

  test("ToggledChapter_Input_IsNotMutated", () => {
    const list = ["a"]
    toggledChapter(list, "b")
    expect(list).toEqual(["a"])
  })
})
