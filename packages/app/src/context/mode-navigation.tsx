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
export const ModeNavigationProvider = publication.Provider
export const useModeNavigation = publication.use
