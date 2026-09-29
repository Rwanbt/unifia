/* SPDX-License-Identifier: MIT */

import type { DesignDocumentV1 } from "./schema"

/**
 * Appends every node, root and asset of `source` to `target` (used by the
 * legacy sketch import). Returns `undefined` when the two documents share an
 * id: a conflict is surfaced, never silently resolved by dropping data.
 */
export function mergeDesignDocuments(
  target: DesignDocumentV1,
  source: DesignDocumentV1,
): DesignDocumentV1 | undefined {
  for (const id of Object.keys(source.nodes)) {
    if (target.nodes[id]) return undefined
  }
  const targetAssets = target.assets ?? {}
  const sourceAssets = source.assets ?? {}
  for (const id of Object.keys(sourceAssets)) {
    if (targetAssets[id]) return undefined
  }
  const assets = { ...targetAssets, ...sourceAssets }
  return {
    ...target,
    rootIds: [...target.rootIds, ...source.rootIds],
    nodes: { ...target.nodes, ...source.nodes },
    assets: Object.keys(assets).length > 0 ? assets : undefined,
  }
}
