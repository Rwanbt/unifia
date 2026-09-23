/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { UNIFIA_ICON_PATH, unifiaIconUrl } from "./brand-icon"
import { notificationIcon } from "./notification-click"

const PUBLIC_DIR = resolve(import.meta.dir, "..", "..", "public")

describe("brand icon", () => {
  test("points at a real file in the shared public dir", () => {
    expect(existsSync(resolve(PUBLIC_DIR, "." + UNIFIA_ICON_PATH))).toBe(true)
  })

  test("resolves to an absolute URL on the app's own origin", () => {
    expect(unifiaIconUrl("http://127.0.0.1:4448/abc/session/xyz")).toBe(
      "http://127.0.0.1:4448/brand/unifia/unifia-192.png",
    )
    expect(unifiaIconUrl("http://tauri.localhost/")).toBe("http://tauri.localhost/brand/unifia/unifia-192.png")
  })

  // Browser notifications showed the OpenCode logo fetched from opencode.ai.
  test("notifications use the Unifia icon, never a remote OpenCode asset", () => {
    // happy-dom starts on about:blank; a real page always has an http(s) or
    // tauri origin.
    const dom = (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM
    const previous = window.location.href
    dom.setURL("http://127.0.0.1:4448/session/abc")
    try {
      expect(notificationIcon()).toBe("http://127.0.0.1:4448/brand/unifia/unifia-192.png")
    } finally {
      dom.setURL(previous)
    }
  })
})
