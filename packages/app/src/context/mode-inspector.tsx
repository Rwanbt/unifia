/* SPDX-License-Identifier: MIT */

import { createModePublication } from "./mode-publication"

export type InspectorRow = { label: string; value: string }
export type InspectorAction = { label: string; run?: () => void }

// Maquette .inspect-card variants: a titled card (h4, optional p, .kv rows,
// actions, a version row) and the Design empty head (.v51-inspector-head).
export type InspectorCard =
  | {
      kind?: "card"
      title: string
      description?: string
      rows?: readonly InspectorRow[]
      actions?: readonly InspectorAction[]
      version?: { title: string; author: string }
    }
  | { kind: "head"; title: string; description: string }

// Each mode's surface publishes the cards for what it shows; the inspector
// only renders them, so it can never describe something the surface does not.
const publication = createModePublication<InspectorCard>()
export const ModeInspectorProvider = publication.Provider
export const useModeInspector = publication.use
