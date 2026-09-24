/* SPDX-License-Identifier: MIT */

// Messages pinned as chapters (ADR-052), kept per workspace in the app's
// persisted storage -- the same place line comments live. The server has no
// field for it, and a chapter is a reading bookmark of this user, not part
// of the conversation.

import { createMemo, createRoot, onCleanup } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import type { Chapters } from "@unifia/ui/context/chapters"
import { Persist, persisted } from "@/utils/persist"
import { createScopedCache } from "@/utils/scoped-cache"

type ChapterStore = { sessions: Record<string, string[]> }

// Workspaces open in one app lifetime; older ones reload from storage.
const MAX_WORKSPACES = 8

/** A new pin list with `messageID` added, or removed when already pinned. */
export function toggledChapter(list: readonly string[], messageID: string): string[] {
  return list.includes(messageID) ? list.filter((id) => id !== messageID) : [...list, messageID]
}

function createWorkspaceChapters(dir: string) {
  const [store, setStore] = persisted(Persist.workspace(dir, "chapters"), createStore<ChapterStore>({ sessions: {} }))
  return { store, setStore: setStore as SetStoreFunction<ChapterStore> }
}

/** Chapters of the session `sessionID()` in workspace `dir()`. */
export function createSessionChapters(dir: () => string | undefined, sessionID: () => string | undefined): Chapters {
  const cache = createScopedCache(
    (key) => createRoot((dispose) => ({ value: createWorkspaceChapters(key), dispose })),
    { maxEntries: MAX_WORKSPACES, dispose: (entry) => entry.dispose() },
  )
  onCleanup(() => cache.clear())

  const workspace = createMemo(() => {
    const key = dir()
    return key ? cache.get(key).value : undefined
  })
  const list = () => {
    const id = sessionID()
    return (id && workspace()?.store.sessions[id]) || []
  }

  return {
    pinned: (messageID) => list().includes(messageID),
    toggle: (messageID) => {
      const id = sessionID()
      const current = workspace()
      if (!id || !current) return
      current.setStore("sessions", id, toggledChapter(list(), messageID))
    },
  }
}
