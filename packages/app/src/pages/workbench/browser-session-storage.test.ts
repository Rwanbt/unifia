/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { browserSessionStorageKey, legacyBrowserSessionStorageKey } from "@/pages/workbench/browser-session-storage"

describe("Browser session storage keys", () => {
  test("separates Browser sessions by workspace and chat", () => {
    expect(browserSessionStorageKey("workspace/a", "chat-1")).not.toBe(browserSessionStorageKey("workspace/a", "chat-2"))
    expect(browserSessionStorageKey("workspace/a", "chat-1")).not.toBe(browserSessionStorageKey("workspace/b", "chat-1"))
    expect(browserSessionStorageKey("workspace.part", "chat")).not.toBe(browserSessionStorageKey("workspace", "part.chat"))
  })

  test("retains the legacy key for safe exact-chat migration", () => {
    expect(legacyBrowserSessionStorageKey("workspace/a")).toBe("unifia.browser.session.v1.workspace/a")
  })
})
