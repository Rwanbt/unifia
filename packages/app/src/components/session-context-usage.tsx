/* SPDX-License-Identifier: MIT */

// The composer's context meter -- the reference's `.context-meter`: a ring in
// the accent colour and, on hover or focus, a card of this session's real
// context metrics. The reference's quota and reset rows have no source in
// Unifia, so they are left out rather than invented (ADR-047).

import { Show, createMemo, createSignal, createUniqueId } from "solid-js"
import { contextLevel } from "./session-context-level"

import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

// The reference's ring: a 36-unit box, radius 15.9, so pathLength 100 maps
// the dash offset straight to a percentage.
const RING_RADIUS = 15.9

function openSessionContext(args: {
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  args.layout.inspector.setTab("inspector")
  if (!args.layout.inspector.opened()) args.layout.inspector.open()
  args.tabs.open("context")
  args.tabs.setActive("context")
}

export function SessionContextUsage(props: { webSearch: boolean }) {
  const sync = useSync()
  const file = useFile()
  const layout = useLayout()
  const language = useLanguage()
  const providers = useProviders()
  const { params, tabs } = useSessionLayout()
  // Touch screens have no hover: the first tap shows the card, the next one
  // opens the detail, as in the reference.
  const [pinnedOpen, setPinnedOpen] = createSignal(false)
  const tipId = createUniqueId()

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  })
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const metrics = createMemo(() => getSessionContextMetrics(messages(), providers.all()))
  const context = createMemo(() => metrics().context)
  const usage = () => context()?.usage ?? 0

  const compact = createMemo(
    () => new Intl.NumberFormat(language.intl(), { notation: "compact", maximumFractionDigits: 1 }),
  )
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))
  const windowLabel = () => {
    const ctx = context()
    if (!ctx) return undefined
    const used = compact().format(ctx.total)
    return ctx.limit ? `${used} / ${compact().format(ctx.limit)}` : used
  }

  const openContext = () => {
    if (!params.id) return
    if (tabState.activeTab() === "context") {
      tabs().close("context")
      return
    }
    openSessionContext({ layout, tabs: tabs() })
  }

  const onClick = () => {
    if (isTouchOnly() && !pinnedOpen()) {
      setPinnedOpen(true)
      return
    }
    setPinnedOpen(false)
    openContext()
  }

  return (
    <Show when={params.id}>
      <button
        type="button"
        data-action="prompt-context"
        data-v110="context-meter"
        data-level={contextLevel(usage())}
        data-open={pinnedOpen() ? "" : undefined}
        style={{ "--usage": usage() }}
        aria-label={language.t("context.meter.label", { usage: usage() })}
        aria-describedby={tipId}
        onClick={onClick}
        onBlur={() => setPinnedOpen(false)}
      >
        <svg aria-hidden="true" viewBox="0 0 36 36">
          <circle data-slot="meter-track" cx="18" cy="18" r={RING_RADIUS} pathLength="100" />
          <circle data-slot="meter-value" cx="18" cy="18" r={RING_RADIUS} pathLength="100" />
        </svg>
        <span id={tipId} role="tooltip" data-slot="context-meter-tip">
          <span data-slot="meter-tip-title">
            <span data-slot="meter-tip-dot" />
            <span>
              <Show when={context()?.usage != null} fallback={language.t("context.meter.title")}>
                {language.t("context.meter.titleUsage", { usage: usage() })}
              </Show>
            </span>
          </span>
          <Show when={context()} fallback={<span data-slot="meter-tip-foot">{language.t("context.meter.empty")}</span>}>
            {(ctx) => (
              <>
                <MeterRow label={language.t("context.meter.window")} value={windowLabel() ?? ""} />
                <MeterRow label={language.t("context.meter.model")} value={ctx().modelLabel} />
                <MeterRow label={language.t("context.meter.provider")} value={ctx().providerLabel} />
                <MeterRow label={language.t("context.meter.cost")} value={usd().format(metrics().totalCost)} />
              </>
            )}
          </Show>
          <MeterRow
            label={language.t("context.meter.web")}
            value={props.webSearch ? language.t("context.meter.webOn") : language.t("context.meter.webOff")}
          />
          <span data-slot="meter-tip-foot">{language.t("context.meter.foot")}</span>
        </span>
      </button>
    </Show>
  )
}

function MeterRow(props: { label: string; value: string }) {
  return (
    <span data-slot="meter-tip-row">
      <span>{props.label}</span>
      <span>{props.value}</span>
    </span>
  )
}

function isTouchOnly() {
  return typeof matchMedia === "function" && matchMedia("(hover: none)").matches
}
