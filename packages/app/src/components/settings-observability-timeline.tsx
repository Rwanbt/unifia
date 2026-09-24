// Phase 3 Timeline + TraceDetail (plan §16), drawn as the reference's
// .timeline-chart (ADR-050): a Session row spanning the window, then one row
// per recent timed event placed on the same scale; clicking a row fetches
// and expands the full span sequence for its trace (TraceDetail),
// including opt-in content when present (settings-observability-privacy.tsx
// is where that content capture is actually turned on).
import { type Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { Select } from "@unifia/ui/select"
import { Icon } from "@unifia/ui/icon"
import { useSDK } from "@/context/sdk"
import { unwrap } from "@/utils/sdk-unwrap"
import { useLanguage } from "@/context/language"
import { observableSessionId } from "./settings-observability-session-id"
import { eventKind, formatDuration } from "./settings-observability-format"

type SessionItem = { id: string; title?: string }
type EventDto = {
  eventId: string
  traceId: string
  spanId: string
  type: string
  status: string
  derivedStatus?: "orphaned"
  tsMs: number
  durationMs?: number
  costNanoUsd?: number
  localContentRedacted?: string
  localFull?: string
  hasSensitiveContent: boolean
}

const MAX_SPANS = 12
const TICKS = 5

type Span = { event: EventDto; startMs: number; endMs: number; kind: "llm" | "tool" | "error" | "session" }

type Trace = { traceId: string; items: EventDto[]; startMs: number }

/** The session's events grouped into traces (one agent turn each), newest first. */
function groupByTrace(events: EventDto[]): Trace[] {
  const traces = new Map<string, EventDto[]>()
  for (const event of events) {
    const bucket = traces.get(event.traceId)
    if (bucket) bucket.push(event)
    else traces.set(event.traceId, [event])
  }
  return [...traces.entries()]
    .map(([traceId, items]) => ({ traceId, items, startMs: Math.min(...items.map((event) => event.tsMs)) }))
    .sort((a, b) => b.startMs - a.startMs)
}

/** A trace's timed events, oldest first: one timeline row each. */
function traceSpans(events: EventDto[]): Span[] {
  return events
    .filter((event) => event.durationMs !== undefined)
    .sort((a, b) => a.tsMs - b.tsMs)
    .slice(-MAX_SPANS)
    .map((event) => {
      const kind = eventKind(event.type, event.status)
      return {
        event,
        startMs: event.tsMs,
        endMs: event.tsMs + (event.durationMs ?? 0),
        kind: kind === "agent" ? "session" : kind,
      }
    })
}

export const SettingsObservabilityTimeline: Component<{
  sessions: SessionItem[]
  sessionId?: string
  refreshKey?: number
  onSelectSession: (id: string) => void
  scope: "project" | "all"
}> = (props) => {
  const language = useLanguage()
  const sdk = useSDK()
  const selected = () => props.sessions.find((s) => s.id === props.sessionId)
  const [expandedTraceId, setExpandedTraceId] = createSignal<string>()
  const [pickedTraceId, setPickedTraceId] = createSignal<string>()

  const [events] = createResource(
    () => {
      const sessionId = observableSessionId(props.sessionId)
      return sessionId ? { sessionId, refreshKey: props.refreshKey, scope: props.scope } : undefined
    },
    (source) =>
      unwrap(
        sdk.client.observability.events.list({ sessionId: source.sessionId, scope: props.scope, limit: 200 }),
      ) as Promise<EventDto[]>,
  )

  const traces = createMemo(() => groupByTrace(events.latest ?? []))
  const shownTrace = () => traces().find((trace) => trace.traceId === pickedTraceId()) ?? traces()[0]
  const traceLabel = (trace: Trace) =>
    `${new Date(trace.startMs).toLocaleString()} · ${language.t("settings.fork.observability.eventCount", { count: trace.items.length })}`
  const spans = createMemo(() => traceSpans(shownTrace()?.items ?? []))
  const windowStart = () => Math.min(...spans().map((span) => span.startMs))
  const windowMs = () => Math.max(1, Math.max(...spans().map((span) => span.endMs)) - windowStart())
  const offset = (ms: number) => `${((ms - windowStart()) / windowMs()) * 100}%`
  const width = (ms: number) => `${Math.max(0.6, (ms / windowMs()) * 100)}%`
  const kindLabel = (kind: Span["kind"]) =>
    kind === "llm"
      ? language.t("settings.observability.kind.llm")
      : kind === "session"
        ? language.t("settings.observability.kind.session")
        : language.t("settings.observability.kind.tool")

  const [trace, traceActions] = createResource(
    expandedTraceId,
    (traceId) =>
      unwrap(sdk.client.observability.trace.get({ traceId, scope: props.scope })) as Promise<{
        traceId: string
        events: EventDto[]
      }>,
  )

  const toggle = (traceId: string) => {
    if (expandedTraceId() === traceId) {
      setExpandedTraceId(undefined)
      return
    }
    setExpandedTraceId(traceId)
    void traceActions.refetch()
  }

  return (
    <>
      <div data-slot="obs-panel-head">
        <h3>{language.t("settings.fork.observability.timeline")}</h3>
        <Select
          size="small"
          variant="secondary"
          triggerVariant="settings"
          options={props.sessions}
          current={selected()}
          value={(item) => item.id}
          label={(item) => item.title || item.id}
          onSelect={(item) => item && props.onSelectSession(item.id)}
        />
      </div>
      <Show when={traces().length > 1}>
        <div data-slot="obs-panel-head">
          <span data-slot="obs-session-count">
            {language.t("settings.observability.traceOf", { count: traces().length })}
          </span>
          <Select
            size="small"
            variant="secondary"
            triggerVariant="settings"
            options={traces()}
            current={shownTrace()}
            value={(trace) => trace.traceId}
            label={traceLabel}
            onSelect={(trace) => trace && setPickedTraceId(trace.traceId)}
          />
        </div>
      </Show>

      <Show
        when={spans().length > 0}
        fallback={<p data-slot="obs-table-empty">{language.t("settings.fork.observability.noTraces")}</p>}
      >
        <div data-slot="timeline-chart">
          <div data-slot="timeline-scale">
            <For each={Array.from({ length: TICKS }, (_, index) => (windowMs() * index) / (TICKS - 1))}>
              {(tick) => <span>{formatDuration(tick)}</span>}
            </For>
          </div>
          <div data-slot="timeline-row">
            <b>{language.t("settings.observability.kind.session")}</b>
            <div data-slot="timeline-track">
              <i data-kind="session" style={{ left: "0%", width: "100%" }} />
            </div>
            <span>{formatDuration(windowMs())}</span>
          </div>
          <For each={spans()}>
            {(span) => (
              <button
                type="button"
                data-slot="timeline-row"
                aria-pressed={expandedTraceId() === span.event.traceId}
                title={span.event.type}
                onClick={() => toggle(span.event.traceId)}
              >
                <b>
                  {kindLabel(span.kind)} · {new Date(span.startMs).toLocaleTimeString()}
                  <Show when={span.event.hasSensitiveContent}>
                    <Icon name="warning" size="small" />
                  </Show>
                </b>
                <div data-slot="timeline-track">
                  <i
                    data-kind={span.kind}
                    style={{ left: offset(span.startMs), width: width(span.endMs - span.startMs) }}
                  />
                </div>
                <span>{formatDuration(span.endMs - span.startMs)}</span>
              </button>
            )}
          </For>
        </div>
        <div data-slot="timeline-legend">
          <span>
            <i data-slot="legend-dot" data-kind="llm" />
            {language.t("settings.observability.kind.llm")}
          </span>
          <span>
            <i data-slot="legend-dot" data-kind="tool" />
            {language.t("settings.observability.kind.tools")}
          </span>
          <span>
            <i data-slot="legend-dot" data-kind="session" />
            {language.t("settings.observability.kind.session")}
          </span>
        </div>
      </Show>

      <Show when={expandedTraceId()}>
        <div class="rounded-lg border border-border-weak-base p-4">
          <h4 class="pb-2 text-13-medium text-text-strong">{language.t("settings.fork.observability.traceDetail")}</h4>
          <Show
            when={!trace.loading && trace.latest}
            fallback={
              <div class="text-12-regular text-text-weak">{language.t("settings.fork.observability.loading")}</div>
            }
          >
            {(value) => (
              <div class="flex flex-col gap-2">
                <For each={value().events}>
                  {(event) => (
                    <div class="rounded-md bg-surface-base px-3 py-2">
                      <div class="flex items-center justify-between text-12-regular">
                        <span class="text-text-strong">{event.type}</span>
                        <span class="text-text-weak">{event.status}</span>
                      </div>
                      <Show when={event.localFull ?? event.localContentRedacted}>
                        {(content) => (
                          <div class="mt-2 flex flex-col gap-1">
                            <div class="flex items-center gap-1 text-11-medium text-icon-critical-base">
                              <Icon name="warning" />
                              {event.localFull
                                ? language.t("settings.fork.observability.fullContentCaptured")
                                : language.t("settings.fork.observability.redactedContentCaptured")}
                            </div>
                            <pre class="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-inset p-2 text-11-regular text-text-strong">
                              {content()}
                            </pre>
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </>
  )
}
