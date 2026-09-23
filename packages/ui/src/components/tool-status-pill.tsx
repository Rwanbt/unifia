/* SPDX-License-Identifier: MIT */

import { Show } from "solid-js"
import { useI18n } from "../context/i18n"

// The reference's step status pill (ADR-045). Errors keep their own card,
// which already names the failure, so only live and finished steps get one.
export function ToolStatusPill(props: { status: string }) {
  const i18n = useI18n()
  const label = () => {
    if (props.status === "completed") return i18n.t("ui.tool.status.completed")
    if (props.status === "running" || props.status === "pending") return i18n.t("ui.tool.status.running")
    return ""
  }
  return (
    <Show when={label()}>
      <span data-slot="tool-status-pill" data-status={props.status}>
        {label()}
      </span>
    </Show>
  )
}
