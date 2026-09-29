/* SPDX-License-Identifier: MIT */

import { createContext, useContext } from "solid-js"

/**
 * Messages pinned as chapters (ADR-052). The app owns storage; without a
 * provider the pin action renders disabled, as it did before chapters had
 * one.
 */
export type Chapters = {
  pinned: (messageID: string) => boolean
  toggle: (messageID: string) => void
}

const ChaptersContext = createContext<Chapters>()

export const ChaptersProvider = ChaptersContext.Provider

export function useChapters(): Chapters | undefined {
  return useContext(ChaptersContext)
}
