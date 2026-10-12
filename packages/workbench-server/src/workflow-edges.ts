/* SPDX-License-Identifier: MIT */

import { EdgeKindSchema } from "@unifia/contracts"
import type { WorkflowDefinitionPort } from "./workflow-port.js"

const EDGE_KINDS: ReadonlySet<string> = new Set(EdgeKindSchema.options)

/** CR04: drawn edges must be well-formed and join steps that exist; absent edges mean the linear chain. */
export function hasValidEdges(definition: WorkflowDefinitionPort): boolean {
  if (definition.edges === undefined) return true
  if (!Array.isArray(definition.edges)) return false
  const ids = new Set(definition.steps.map((step) => step?.id))
  return definition.edges.every(
    (edge) =>
      typeof edge === "object" && edge !== null &&
      typeof edge.from === "string" && typeof edge.to === "string" &&
      ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to &&
      (edge.kind === undefined || EDGE_KINDS.has(edge.kind)),
  )
}
