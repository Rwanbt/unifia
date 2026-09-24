/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { chatMaxWidth, splitChatWidth } from "./chat-width"

describe("chatMaxWidth", () => {
  test("ChatMaxWidth_Workspace_IsHalfOfIt", () => {
    expect(chatMaxWidth(1000)).toBe(500)
  })

  test("ChatMaxWidth_NarrowWorkspace_NeverBelowMinimum", () => {
    expect(chatMaxWidth(400)).toBe(280)
  })

  test("ChatMaxWidth_HugeWorkspace_CappedAt1200", () => {
    expect(chatMaxWidth(4000)).toBe(1200)
  })
})

describe("splitChatWidth", () => {
  test("SplitChatWidth_NotResizedWide_UsesLayoutDefault", () => {
    expect(splitChatWidth({ resized: false, width: 330, compact: false })).toBe("clamp(280px, 330px, min(50%, 1200px))")
  })

  test("SplitChatWidth_NotResizedCompact_Uses36vw", () => {
    expect(splitChatWidth({ resized: false, width: 500, compact: true })).toBe("clamp(280px, 36vw, min(50%, 1200px))")
  })

  test("SplitChatWidth_Resized_UsesStoredWidth", () => {
    expect(splitChatWidth({ resized: true, width: 512.4, compact: true })).toBe("clamp(280px, 512px, min(50%, 1200px))")
  })
})
