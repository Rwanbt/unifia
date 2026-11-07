/* SPDX-License-Identifier: MIT */

import { Show, createMemo } from "solid-js"
import type { AssistantMessage } from "../types/sdk-shim"
import { useI18n } from "../context/i18n"
import { BasicTool } from "./basic-tool"
import { ToolStatusPill } from "./tool-status-pill"

// The reference's "Usage" step (observability domain "usage", ADR-046): what
// a finished reply cost -- its duration, the tokens it processed and, when
// the provider bills it, the price.

import { turnUsage } from "./turn-usage-logic"
export { turnUsage } from "./turn-usage-logic"
export type { TurnUsage } from "./turn-usage-logic"

export function TurnUsageStep(props: { messages: readonly AssistantMessage[]; durationMs?: number }) {
  const i18n = useI18n()
  const usage = createMemo(() => turnUsage(props.messages, props.durationMs))
  const locale = () => i18n.locale()
  const summary = createMemo(() => {
    const u = usage()
    const parts: string[] = []
    if (typeof u.durationMs === "number") {
      const seconds = u.durationMs / 1000
      parts.push(
        i18n.t("ui.message.usage.seconds", {
          count: new Intl.NumberFormat(locale(), { maximumFractionDigits: seconds < 60 ? 1 : 0 }).format(seconds),
        }),
      )
    }
    if (u.tokens > 0)
      parts.push(new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(u.tokens))
    if (u.cost > 0) parts.push(new Intl.NumberFormat(locale(), { style: "currency", currency: "USD" }).format(u.cost))
    return parts.join(" · ")
  })
  return (
    <Show when={summary()}>
      {/* Built like a tool step, so the stack's hairlines and pill apply. */}
      <div data-component="tool-part-wrapper" data-part-type="usage">
        <BasicTool icon="speedometer" trigger={{ title: i18n.t("ui.message.usage.title"), subtitle: summary() }} />
        <ToolStatusPill status="completed" />
      </div>
    </Show>
  )
}
