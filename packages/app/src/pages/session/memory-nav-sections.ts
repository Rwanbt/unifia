/* SPDX-License-Identifier: MIT */

import type { NavSection } from "@/context/mode-navigation"

type Translate = (key: string) => string

export type MemoryNavInput = {
  readonly surface: "note" | "graph"
  readonly noteCount: number
  readonly backlinkCount: number
  readonly onShowNotes: () => void
  readonly onShowGraph: () => void
  readonly onShowBacklinks: () => void
}

/** The Memory side panel: the panel's own views, each row doing what the panel already does. */
export function memoryNavSections(input: MemoryNavInput, t: Translate): readonly NavSection[] {
  return [
    {
      id: "memory.memory",
      titleKey: "sidebar.nav.memory",
      rows: [
        { id: "notes", glyph: "◈", label: t("sidebar.nav.notes"), badge: String(input.noteCount), active: input.surface === "note", onSelect: input.onShowNotes },
        { id: "graph", glyph: "◎", label: t("sidebar.nav.graph"), active: input.surface === "graph", onSelect: input.onShowGraph },
        { id: "backlinks", glyph: "↗", label: t("sidebar.nav.backlinks"), badge: String(input.backlinkCount), onSelect: input.onShowBacklinks },
      ],
    },
  ]
}
