/* SPDX-License-Identifier: MIT */

import { createModePublication } from "./mode-publication"

export type NavRowModel = {
  readonly id: string
  readonly glyph: string
  readonly label: string
  readonly active?: boolean
  readonly badge?: string
  /** Absent when the row only informs: it then renders as text, not as a button. */
  readonly onSelect?: () => void
}

export type NavSection = {
  readonly id: string
  /** i18n key of the section title (the `sidebar.nav.*` family). */
  readonly titleKey: string
  readonly rows: readonly NavRowModel[]
  /** The section's own tally when it is not its row count (Runs counts runs, not its two rows). */
  readonly count?: number
  /** i18n key of the line shown when the section has no row. */
  readonly emptyKey?: string
}

// Each mode's surface publishes the sections of its side panel from the state
// it already holds, so a row can never name something the surface lacks.
const publication = createModePublication<NavSection>()

/**
 * One section per id, the most recently published winning, in first-seen order.
 * WHY: a mode can have several live instances of its surface (Design keeps one
 * canvas tab per open page), each publishing the same sections, which showed
 * "Pages" and "Design system" once per instance in the side panel.
 */
export function uniqueSections(sections: readonly NavSection[]): readonly NavSection[] {
  const byId = new Map<string, NavSection>()
  for (const section of sections) {
    byId.delete(section.id)
    byId.set(section.id, section)
  }
  const order = [...new Set(sections.map((section) => section.id))]
  return order.map((id) => byId.get(id)!)
}
export const ModeNavigationProvider = publication.Provider
export const useModeNavigation = publication.use
