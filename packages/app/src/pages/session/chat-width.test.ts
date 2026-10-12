/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { chatMaxWidth, sessionChatWidth, splitChatWidth } from "./chat-width"

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

  test("SplitChatWidth_CompactWithSidePanel_UsesReferenceSideWidth", () => {
    expect(splitChatWidth({ resized: true, width: 500, compact: true, sidePanelOpen: true })).toBe(
      "clamp(240px, 28vw, 290px)",
    )
  })
})

describe("sessionChatWidth", () => {
  const base = {
    resized: false,
    width: 330,
    sidebarOpen: false,
    inspectorOpen: false,
    inspectorWidth: 300,
    mobileDevice: false,
  }

  test("SessionChatWidth_MainLayout_CollapsesTheChat", () => {
    expect(sessionChatWidth({ ...base, layout: "main", side: "overlay" })).toBe("0px")
  })

  test("SessionChatWidth_ChatOnGrid_UsesTheCentredColumn", () => {
    expect(sessionChatWidth({ ...base, layout: "chat", side: "grid" })).toBe("var(--v110-chat-column)")
  })

  test("SessionChatWidth_SplitOnGrid_UsesTheWideSplitWidth", () => {
    expect(sessionChatWidth({ ...base, layout: "split", side: "grid" })).toBe("clamp(280px, 330px, min(50%, 1200px))")
  })

  test("SessionChatWidth_SplitOnSingle_UsesTheCompactSplitWidth", () => {
    expect(sessionChatWidth({ ...base, layout: "split", side: "single" })).toBe("clamp(280px, 36vw, min(50%, 1200px))")
  })

  // Compact landscape offers Split with an overlay side. A full-width chat
  // there left the main pane 0px wide and every mode surface off-screen.
  test("SessionChatWidth_SplitOnOverlay_LeavesRoomForTheMainPane", () => {
    expect(sessionChatWidth({ ...base, layout: "split", side: "overlay" })).toBe("clamp(280px, 36vw, min(50%, 1200px))")
  })

  test("SessionChatWidth_ChatOnOverlayWithoutInspector_TakesTheFullWidth", () => {
    expect(sessionChatWidth({ ...base, layout: "chat", side: "overlay" })).toBe("100%")
  })

  test("SessionChatWidth_ChatWithInspectorOnDesktop_LeavesTheInspectorTrack", () => {
    expect(sessionChatWidth({ ...base, layout: "chat", side: "single", inspectorOpen: true })).toBe(
      "calc(100% - 300px - var(--v110-inspector-margins))",
    )
  })

  test("SessionChatWidth_ChatWithInspectorOnMobileDevice_TakesHalf", () => {
    expect(sessionChatWidth({ ...base, layout: "chat", side: "single", inspectorOpen: true, mobileDevice: true })).toBe(
      "50%",
    )
  })
})
