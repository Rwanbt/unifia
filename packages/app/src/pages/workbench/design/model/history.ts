/* SPDX-License-Identifier: MIT */

import type { DesignDocumentV1 } from "./schema"

export type DesignHistoryState = {
  past: readonly DesignDocumentV1[]
  future: readonly DesignDocumentV1[]
}

export const designHistoryLimit = 100

export const emptyDesignHistory: DesignHistoryState = { past: [], future: [] }

/**
 * History lives at the canonical document-operation layer (ADR-039 section
 * 13): one committed command is one entry, whatever originated it — canvas,
 * keyboard, layers panel or a future agent. Documents are immutable values,
 * so a snapshot per entry is exact and cheap at this scale.
 */
export function recordDesignHistory(
  state: DesignHistoryState,
  previous: DesignDocumentV1,
  limit: number = designHistoryLimit,
): DesignHistoryState {
  const past = [...state.past, previous]
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] }
}

export function undoDesignHistory(
  state: DesignHistoryState,
  current: DesignDocumentV1,
): { state: DesignHistoryState; document: DesignDocumentV1 } | undefined {
  const previous = state.past[state.past.length - 1]
  if (!previous) return undefined
  return { state: { past: state.past.slice(0, -1), future: [current, ...state.future] }, document: previous }
}

export function redoDesignHistory(
  state: DesignHistoryState,
  current: DesignDocumentV1,
): { state: DesignHistoryState; document: DesignDocumentV1 } | undefined {
  const next = state.future[0]
  if (!next) return undefined
  return { state: { past: [...state.past, current], future: state.future.slice(1) }, document: next }
}
