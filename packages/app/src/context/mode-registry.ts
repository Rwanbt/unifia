/* SPDX-License-Identifier: MIT */

import { createSignal, onCleanup } from "solid-js"
import type { WorkspaceDestination } from "./mode-directory"

export type ModeRegistry<T> = {
  /**
   * Publishes what a surface shows for its mode. `read` is reactive: the
   * consumer re-renders when the surface's state changes. Must be called
   * inside a reactive owner (a component); the entry is removed on cleanup.
   */
  publish(mode: WorkspaceDestination, read: () => readonly T[]): void
  read(mode: WorkspaceDestination): readonly T[]
}

type Entry<T> = { readonly mode: WorkspaceDestination; readonly read: () => readonly T[] }

export function createModeRegistry<T>(): ModeRegistry<T> {
  const [entries, setEntries] = createSignal<readonly Entry<T>[]>([])
  return {
    publish(mode, read) {
      const entry: Entry<T> = { mode, read }
      setEntries((list) => [...list, entry])
      onCleanup(() => setEntries((list) => list.filter((candidate) => candidate !== entry)))
    },
    read(mode) {
      return entries()
        .filter((entry) => entry.mode === mode)
        .flatMap((entry) => entry.read())
    },
  }
}
