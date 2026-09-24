// Phase 3 CostDashboard (plan §16), laid out as the reference's Cost view
// (.cost-cards, .cost-sparkline, .cohort-table -- ADR-050). Everything comes
// from existing endpoints: /summary/aggregate for the totals, the previous
// week and the daily buckets (totals since each midnight, differenced), and
// /compare for the per-configuration rows. Tokens are not recorded per
// configuration, so that column shows "—".
import { type Component, createMemo, createResource, For, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { unwrap } from "@/utils/sdk-unwrap"
import { useLanguage } from "@/context/language"
import { cohortTotalCost, type CohortMetrics } from "./settings-observability-compare"
import { dailyFromCumulative, dayBounds, formatCost, formatPercent } from "./settings-observability-format"

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 7

type Aggregate = {
  totalEvents: number
  totalCostNanoUsd: number
  byType?: Record<string, number>
  byStatus?: Record<string, number>
}

export const SettingsObservabilityCost: Component<{ refreshKey?: number; scope: "project" | "all" }> = (props) => {
  const language = useLanguage()
  const sdk = useSDK()
  const aggregate = (sinceMs: number) =>
    unwrap(sdk.client.observability.summaryAggregate({ sinceMs, scope: props.scope })) as Promise<Aggregate>
  const source = () => [props.refreshKey, props.scope] as const

  const [totals] = createResource(source, async () => {
    const now = Date.now()
    const [week, twoWeeks] = await Promise.all([
      aggregate(now - WINDOW_DAYS * DAY_MS),
      aggregate(now - 2 * WINDOW_DAYS * DAY_MS),
    ])
    return { week, previousCost: twoWeeks.totalCostNanoUsd - week.totalCostNanoUsd }
  })
  const [days] = createResource(source, async () => {
    const bounds = dayBounds(new Date(), WINDOW_DAYS)
    const since = await Promise.all(
      bounds.slice(0, -1).map((start) => aggregate(start).then((x) => x.totalCostNanoUsd)),
    )
    const costs = dailyFromCumulative([...since, 0])
    return costs.map((cost, index) => ({ cost, start: bounds[index] }))
  })
  const [comparison] = createResource(source, () =>
    unwrap(sdk.client.observability.compare({ timeWindowMs: WINDOW_DAYS * DAY_MS, scope: props.scope })),
  )

  const week = () => totals.latest?.week
  const total = () => week()?.totalEvents ?? 0
  const share = (count: number) => (total() > 0 ? formatPercent((count / total()) * 100) : "—")
  const llmCalls = () =>
    Object.entries(week()?.byType ?? {})
      .filter(([type]) => type.startsWith("llm.") && type.endsWith(".started"))
      .reduce((sum, [, count]) => sum + count, 0)
  const failed = () => week()?.byStatus?.failed ?? 0
  const aborted = () => week()?.byStatus?.aborted ?? 0
  const trend = () => {
    const previous = totals.latest?.previousCost ?? 0
    const current = week()?.totalCostNanoUsd ?? 0
    if (previous <= 0) return undefined
    const delta = ((current - previous) / previous) * 100
    return `${delta > 0 ? "+" : ""}${formatPercent(delta)}`
  }

  const cohorts = createMemo(() =>
    [...((comparison.latest?.cohorts ?? []) as CohortMetrics[])].sort(
      (a, b) => cohortTotalCost(b) - cohortTotalCost(a),
    ),
  )
  const maxDay = () => Math.max(0, ...(days.latest ?? []).map((day) => day.cost))
  const dayLabel = (start: number) => {
    const label = new Date(start).toLocaleDateString(undefined, { weekday: "short" }).replace(/\.$/, "")
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  const unknown = () => language.t("settings.fork.observability.unknown")

  return (
    <>
      <h3>{language.t("settings.fork.observability.costLast7Days")}</h3>
      <div data-slot="cost-cards">
        <div>
          <span>{language.t("settings.fork.observability.totalCost")}</span>
          <b>{formatCost(week()?.totalCostNanoUsd ?? 0)}</b>
          <small>{trend() ? language.t("settings.observability.cost.vsPrevious", { delta: trend()! }) : " "}</small>
        </div>
        <div>
          <span>{language.t("settings.fork.observability.totalEvents")}</span>
          <b>{total().toLocaleString()}</b>
          <small>{language.t("settings.observability.cost.llmCalls", { count: llmCalls() })}</small>
        </div>
        <div>
          <span>{language.t("settings.fork.observability.failed")}</span>
          <b>{failed()}</b>
          <small>{language.t("settings.observability.cost.ofTotal", { share: share(failed()) })}</small>
        </div>
        <div>
          <span>{language.t("settings.fork.observability.aborted")}</span>
          <b>{aborted()}</b>
          <small>{language.t("settings.observability.cost.ofTotal", { share: share(aborted()) })}</small>
        </div>
      </div>

      <div data-slot="cost-sparkline">
        <div data-slot="spark-bars">
          <For each={days.latest ?? []}>
            {(day) => (
              <i
                style={{ height: `${maxDay() > 0 ? (day.cost / maxDay()) * 100 : 0}%` }}
                title={`${dayLabel(day.start)} · ${formatCost(day.cost)}`}
              />
            )}
          </For>
        </div>
        <div data-slot="spark-labels">
          <For each={days.latest ?? []}>{(day) => <span>{dayLabel(day.start)}</span>}</For>
        </div>
      </div>

      <h3>{language.t("settings.fork.observability.costPerTurn")}</h3>
      <Show
        when={cohorts().length > 0}
        fallback={<p data-slot="obs-table-empty">{language.t("settings.fork.observability.noCohortData")}</p>}
      >
        <div data-slot="cohort-table" data-flush>
          <div data-slot="cohort-head">
            <span>{language.t("settings.observability.col.configuration")}</span>
            <span>{language.t("settings.observability.col.turns")}</span>
            <span>{language.t("settings.observability.col.tokens")}</span>
            <span>{language.t("settings.observability.col.perTurn")}</span>
            <span>{language.t("settings.observability.col.total")}</span>
          </div>
          <For each={cohorts()}>
            {(cohort) => (
              <div data-slot="cohort-row">
                <span>
                  <b>{cohort.modelId ?? unknown()}</b>
                  <small>{cohort.modelProvider ?? unknown()}</small>
                </span>
                <span>{cohort.traceCount}</span>
                <span>—</span>
                <span>{formatCost(cohort.costPerTurnNanoUsd, 3)}</span>
                <span>{formatCost(cohortTotalCost(cohort), 2)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}
