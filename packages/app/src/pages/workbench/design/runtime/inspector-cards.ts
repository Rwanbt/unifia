/* SPDX-License-Identifier: MIT */

import type { InspectorCard } from "@/context/mode-inspector"
import type { DesignDocumentV1, DesignNodeId } from "../model/schema"

type Translate = (key: string, params?: Record<string, string | number>) => string

const round = (value: number): string => String(Math.round(value * 100) / 100)

/** What the inspector shows for the canvas: nothing, one node's geometry, or a count. */
export function designInspectorCards(
  document: DesignDocumentV1,
  selection: readonly DesignNodeId[],
  t: Translate,
): readonly InspectorCard[] {
  const nodes = selection.flatMap((id) => document.nodes[id] ?? [])
  if (nodes.length === 0) {
    return [{ kind: "head", title: t("design.studio.inspector.emptyTitle"), description: t("design.studio.inspector.emptyHint") }]
  }
  if (nodes.length > 1) {
    return [{ title: t("design.studio.inspector.multiple", { count: nodes.length }) }]
  }
  const node = nodes[0]!
  const { x, y, width, height, rotation } = node.transform
  const yesNo = (value: boolean) => t(value ? "design.studio.inspector.yes" : "design.studio.inspector.no")
  return [
    {
      title: node.name,
      rows: [
        { label: t("design.studio.inspector.type"), value: node.type },
        { label: t("design.studio.inspector.position"), value: `${round(x)}, ${round(y)}` },
        { label: t("design.studio.inspector.size"), value: `${round(width)} × ${round(height)}` },
        { label: t("design.studio.inspector.rotation"), value: `${round(rotation)}°` },
        { label: t("design.studio.inspector.visible"), value: yesNo(node.visible) },
        { label: t("design.studio.inspector.locked"), value: yesNo(node.locked) },
      ],
    },
  ]
}
