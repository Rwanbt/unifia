/* SPDX-License-Identifier: MIT */

// The reference's session event table (.obs-session-table-head + .obs-table),
// shared by the Traces and Events sub-tabs (ADR-050): a coloured dot per event
// family, a status pill, the time and the duration / cost.

import { type Component, For } from "solid-js"
import { useLanguage } from "@/context/language"
import { eventKind, formatDurationCost, statusTone, type StatusTone } from "./settings-observability-format"

export type ObservabilityEvent = {
  traceId?: string
  type: string
  status: string
  derivedStatus?: string
  tsMs: number
  durationMs?: number
  costNanoUsd?: number
}

const TONE_LABEL: Record<StatusTone, "ok" | "running" | "failed"> = { ok: "ok", warn: "running", err: "failed" }

export const ObservabilityEventTable: Component<{ events: ObservabilityEvent[] }> = (props) => {
  const language = useLanguage()
  const pill = (event: ObservabilityEvent) =>
    event.derivedStatus === "orphaned"
      ? language.t("settings.fork.observability.orphaned")
      : language.t(`settings.observability.status.${TONE_LABEL[statusTone(event.status)]}`)

  return (
    <>
      <div data-slot="obs-table-head">
        <span>{language.t("settings.fork.observability.type")}</span>
        <span>{language.t("settings.fork.observability.status")}</span>
        <span>{language.t("settings.fork.observability.time")}</span>
        <span>{language.t("settings.fork.observability.durationCost")}</span>
      </div>
      <div data-slot="obs-table">
        <For
          each={props.events}
          fallback={<p data-slot="obs-table-empty">{language.t("settings.fork.observability.noSessionEvents")}</p>}
        >
          {(event) => (
            <div data-slot="obs-data-row">
              <span title={event.type}>
                <i data-slot="event-dot" data-kind={eventKind(event.type, event.status)} />
                <span>{event.type}</span>
              </span>
              <span>
                <b
                  data-slot="status-pill"
                  data-tone={statusTone(event.status, event.derivedStatus)}
                  title={event.status}
                >
                  {pill(event)}
                </b>
              </span>
              <span>{new Date(event.tsMs).toLocaleTimeString()}</span>
              <span>{formatDurationCost(event.durationMs, event.costNanoUsd)}</span>
            </div>
          )}
        </For>
      </div>
    </>
  )
}

/** How many distinct traces the listed events belong to. */
export const traceCount = (events: { traceId?: string }[]) => new Set(events.map((event) => event.traceId)).size
