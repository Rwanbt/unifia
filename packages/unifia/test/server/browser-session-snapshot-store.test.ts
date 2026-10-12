/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrowserSessionSchema } from "@unifia/contracts/browser"
import { BrowserSessionSqliteStore } from "../../src/server/browser-session-snapshot-store"

describe("BrowserSessionSqliteStore", () => {
  test("recovers encrypted tabs with the same key and isolates a rotated key", async () => {
    const root = await mkdtemp(join(tmpdir(), "unifia-browser-sessions-"))
    const file = join(root, "browser-sessions.db")
    const session = BrowserSessionSchema.parse({
      id: "session-a", workspaceId: "workspace-a", chatSessionId: "chat-a", profileId: "profile-a",
      runtimeProfile: "isolated", controller: "ai", activeTabId: "tab-a",
      tabs: [{ id: "tab-a", pageId: "tab-a", url: "https://example.com/private?access_token=secret", origin: "https://example.com", title: "Private", loading: false, canGoBack: false, canGoForward: false, status: "ready" }],
      viewport: { width: 900, height: 700 }, status: "ready", createdAt: 1, updatedAt: 2,
    })
    try {
      const first = BrowserSessionSqliteStore.open(file, "stable-secret")
      first.save(session)
      const storage = { cookies: [{ name: "session", value: "private-cookie", domain: "example.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }], origins: [{ origin: "https://example.com", localStorage: [{ name: "token", value: "private-local-value" }] }] }
      first.saveStorage(session.id, storage)
      first.close()
      expect((await readFile(file)).toString("utf8")).not.toContain("access_token=secret")
      expect((await readFile(file)).toString("utf8")).not.toContain("private-cookie")
      expect((await readFile(file)).toString("utf8")).not.toContain("private-local-value")

      const rotated = BrowserSessionSqliteStore.open(file, "rotated-secret")
      expect(rotated.load()).toEqual([])
      expect(rotated.loadStorage(session.id)).toBeUndefined()
      rotated.close()

      const resumed = BrowserSessionSqliteStore.open(file, "stable-secret")
      expect(resumed.load()).toEqual([session])
      expect(resumed.loadStorage(session.id)).toEqual(storage)
      resumed.deleteStorage(session.id)
      expect(resumed.loadStorage(session.id)).toBeUndefined()
      resumed.save(BrowserSessionSchema.parse({ ...session, tabs: [], activeTabId: null, status: "closed" }))
      expect(resumed.load()).toEqual([])
      resumed.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
