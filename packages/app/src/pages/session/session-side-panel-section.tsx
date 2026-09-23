/* SPDX-License-Identifier: MIT */

import { SessionSidePanel } from "@/pages/session/session-side-panel"
import type { Sizing } from "@/pages/session/helpers"
import type { FileDiff } from "@/types/sdk-shim"
import type { JSX } from "solid-js"

/**
 * Vague 4 P1-5 (ADR-037) — typed wrapper around SessionSidePanel that lifts
 * the 12 inline props into a single dependency bundle. The host (session.tsx)
 * still owns the closure vars; this file only reshapes the JSX call site so
 * the orchestrator stays compact.
 *
 * Prop shape mirrors SessionSidePanel's signature: memos/accessors for derived
 * values, plain values for stable identifiers and flags. `size` reuses the
 * canonical `Sizing` helper type so it stays compatible with createSizing().
 */
export interface SessionSidePanelSectionProps {
  canReview: () => boolean
  diffs: () => FileDiff[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff: string | undefined
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  sessionId: string | undefined
  /** Rewinds the session to just before a user turn (Code inspector History). */
  revert: (messageID: string) => void
  reverting: () => boolean
}

export function SessionSidePanelSection(props: SessionSidePanelSectionProps) {
  return (
    <SessionSidePanel
      canReview={props.canReview}
      diffs={props.diffs}
      diffsReady={props.diffsReady}
      empty={props.empty}
      hasReview={props.hasReview}
      reviewCount={props.reviewCount}
      reviewPanel={props.reviewPanel}
      activeDiff={props.activeDiff}
      focusReviewDiff={props.focusReviewDiff}
      reviewSnap={props.reviewSnap}
      size={props.size}
      sessionId={props.sessionId}
      revert={props.revert}
      reverting={props.reverting}
    />
  )
}
