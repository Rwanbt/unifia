/* SPDX-License-Identifier: MIT */

// Comparisons -- the reference's .cohort-table and .comparison-bars (ADR-050).
// One row per (provider, model, skill) cohort from /observability/compare;
// the bars rank cohorts by median latency, the fastest drawn longest.

import { type Component, createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { formatCost, formatDuration, formatPercent } from "./settings-observability-format"

export type CohortMetrics = {
  modelProvider: string | null
  modelId: string | null
  skillHmac: string | null
  latencyP50Ms: number
  latencyP95Ms: number
  costPerTurnNanoUsd: number
  failureRatePct: number
  totalEvents: number
  traceCount: number
}

export const cohortTotalCost = (cohort: CohortMetrics) => cohort.costPerTurnNanoUsd * cohort.traceCount

export const SettingsObservabilityCompare: Component<{ cohorts: CohortMetrics[] }> = (props) => {
  const language = useLanguage()
  const unknown = () => language.t("settings.fork.observability.unknown")
  const byLatency = createMemo(() =>
    props.cohorts.filter((cohort) => cohort.latencyP50Ms > 0).sort((a, b) => a.latencyP50Ms - b.latencyP50Ms),
  )
  const fastest = () => byLatency()[0]?.latencyP50Ms ?? 1

  return (
    <>
      <h3>{language.t("settings.fork.observability.compare")}</h3>
      <p data-slot="settings-note" data-flush>
        {language.t("settings.fork.observability.compareDescription")}
      </p>
      <p data-slot="settings-note" data-flush>
        {language.t("settings.fork.observability.cohortNotice")}
      </p>
      <Show
        when={props.cohorts.length > 0}
        fallback={<p data-slot="obs-table-empty">{language.t("settings.fork.observability.noCohortData")}</p>}
      >
        <div data-slot="cohort-table">
          <div data-slot="cohort-head">
            <span>{language.t("settings.observability.col.configuration")}</span>
            <span>{language.t("settings.observability.col.calls")}</span>
            <span>{language.t("settings.observability.col.success")}</span>
            <span>{language.t("settings.observability.col.latency")}</span>
            <span>{language.t("settings.observability.col.cost")}</span>
          </div>
          <For each={props.cohorts}>
            {(cohort) => (
              <div data-slot="cohort-row">
                <span>
                  <b>{cohort.modelProvider ?? unknown()}</b>
                  <small>{cohort.modelId ?? unknown()}</small>
                </span>
                <span>{cohort.totalEvents}</span>
                <span>{formatPercent(100 - cohort.failureRatePct)}</span>
                <span title={`p95 ${formatDuration(cohort.latencyP95Ms)}`}>
                  {formatDuration(cohort.latencyP50Ms) ?? "—"}
                </span>
                <span>{formatCost(cohortTotalCost(cohort), 2)}</span>
              </div>
            )}
          </For>
        </div>
        <div data-slot="comparison-bars">
          <For each={byLatency()}>
            {(cohort) => (
              <div>
                <span>{cohort.modelId ?? unknown()}</span>
                <i style={{ width: `${(fastest() / cohort.latencyP50Ms) * 100}%` }} />
                <b>{formatDuration(cohort.latencyP50Ms)}</b>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}
