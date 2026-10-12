/* SPDX-License-Identifier: MIT */

import type { InspectorCard, InspectorRow } from "@/context/mode-inspector"
import type { WorkflowStepSummary } from "./automate-workflow-model"

type Translate = (key: string, params?: Record<string, string | number>) => string

export type AutomateNodeSelection = {
  readonly node: WorkflowStepSummary
  readonly index: number
  readonly x?: number
  readonly y?: number
  readonly overridden: boolean
  readonly outgoing: readonly string[]
  readonly incoming: readonly string[]
}

/** What the inspector shows for the flow: the selected node's metadata, or how to select one. */
export function automateInspectorCards(
  selection: AutomateNodeSelection | undefined,
  total: number,
  t: Translate,
): readonly InspectorCard[] {
  if (!selection) {
    return [{ title: t("workbench.automate.inspector.title"), description: t("workbench.automate.inspector.empty") }]
  }
  const { node } = selection
  const rows: InspectorRow[] = [
    { label: t("workbench.automate.inspector.field.id"), value: node.id },
    { label: t("workbench.automate.inspector.field.position"), value: t("workbench.automate.inspector.positionValue", { index: selection.index + 1, total }) },
  ]
  if (selection.x !== undefined && selection.y !== undefined) {
    const dragged = selection.overridden ? ` ${t("workbench.automate.inspector.coordinatesOverridden")}` : ""
    rows.push({
      label: t("workbench.automate.inspector.field.coordinates"),
      value: `${t("workbench.automate.inspector.coordinatesValue", { x: Math.round(selection.x), y: Math.round(selection.y) })}${dragged}`,
    })
  }
  rows.push({
    label: t("workbench.automate.inspector.field.approval"),
    value: t(node.requiresApproval ? "workbench.automate.inspector.approvalYes" : "workbench.automate.inspector.approvalNo"),
  })
  if (selection.outgoing.length > 0) rows.push({ label: t("workbench.automate.inspector.edgesOutgoingLabel"), value: selection.outgoing.join(", ") })
  if (selection.incoming.length > 0) rows.push({ label: t("workbench.automate.inspector.edgesIncomingLabel"), value: selection.incoming.join(", ") })
  return [{ title: node.label, rows }]
}
