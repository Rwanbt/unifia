/* SPDX-License-Identifier: MIT */

import type { Accessor } from "solid-js"

/**
 * Vague 4 P1-5 (ADR-037) — small helper to build the SessionComposerRegion
 * `revert` dock props from the closure-driven accessors in session.tsx.
 *
 * Kept as a free function (not a SolidJS component) so the inline JSX
 * call site stays trivial: `revert={buildRevertDockProps(...)}`.
 */
export interface RevertDockProps {
  items: Array<{ id: string; text: string }>
  restoring?: string | undefined
  disabled?: boolean | undefined
  onRestore: (id: string) => void
}

export function buildRevertDockProps(deps: {
  rolled: Accessor<Array<{ id: string; text: string }>>
  restoring: Accessor<string | undefined>
  reverting: Accessor<boolean | undefined>
  restore: (id: string) => void
}): RevertDockProps | undefined {
  if (deps.rolled().length === 0) return undefined
  return {
    items: deps.rolled(),
    restoring: deps.restoring(),
    disabled: deps.reverting(),
    onRestore: deps.restore,
  }
}
