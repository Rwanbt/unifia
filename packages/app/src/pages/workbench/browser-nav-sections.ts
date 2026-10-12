/* SPDX-License-Identifier: MIT */

import type { NavSection } from "@/context/mode-navigation"
import { visitedLabel } from "./design-browser-model"

type Translate = (key: string) => string

export type BrowserNavInput = {
  /** Pages this session opened, most recent first. */
  readonly visited: readonly string[]
  /** Address the tab currently shows. */
  readonly current: string | undefined
  readonly onOpen: (address: string) => void
}

/** The Browser side panel: the pages opened in this session, and nothing else. */
export function browserNavSections(input: BrowserNavInput, t: Translate): readonly NavSection[] {
  return [
    {
      id: "browser.history",
      titleKey: "sidebar.nav.history",
      emptyKey: "sidebar.nav.noHistory",
      rows: input.visited.map((address) => ({
        id: address,
        glyph: "◷",
        label: visitedLabel(address) || t("sidebar.nav.history"),
        active: address === input.current,
        onSelect: () => input.onOpen(address),
      })),
    },
  ]
}
