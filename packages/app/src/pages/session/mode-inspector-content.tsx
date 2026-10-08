/* SPDX-License-Identifier: MIT */

import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import type { WorkspaceDestination } from "@/context/mode-directory"
import { useLanguage } from "@/context/language"
import { useModeInspector, type InspectorCard } from "@/context/mode-inspector"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { browserExecutionEvents, EXECUTION_FILTERS, executionRows, type ExecutionEvent, type ExecutionFilter } from "./execution-log"

function InspectorCardView(props: { card: InspectorCard }): JSX.Element {
  const card = props.card
  if (card.kind === "head")
    return (
      <section data-inspector-head>
        <b>{card.title}</b>
        <small>{card.description}</small>
      </section>
    )
  return (
    <section data-inspector-card>
      <h4>{card.title}</h4>
      <Show when={card.description}>
        <p>{card.description}</p>
      </Show>
      <For each={card.rows ?? []}>
        {(row) => (
          <div data-inspector-row>
            <span>{row.label}</span>
            <span>{row.value}</span>
          </div>
        )}
      </For>
      <Show when={card.actions}>
        <div data-inspector-actions>
          <For each={card.actions}>
            {(action) => (
              <button type="button" aria-disabled={action.run ? undefined : "true"} onClick={() => action.run?.()}>
                {action.label}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={card.version}>
        {(version) => (
          <div data-inspector-version>
            <b>{version().title}</b>
            <span>{version().author}</span>
          </div>
        )}
      </Show>
    </section>
  )
}

export function ModeInspectorSurface(props: { mode: WorkspaceDestination }): JSX.Element {
  const inspector = useModeInspector()
  const language = useLanguage()
  // Every mode publishes its own cards; when its surface is not open there is
  // nothing to describe, and saying so beats showing placeholder facts.
  const cards = (): readonly InspectorCard[] => {
    const published = inspector.read(props.mode)
    if (published.length > 0) return published
    return [{ title: language.t("inspector.empty.title"), description: language.t("inspector.empty.description") }]
  }
  return (
    <div data-mode-inspector={props.mode} data-inspector-state="default">
      <For each={cards()}>{(card) => <InspectorCardView card={card} />}</For>
    </div>
  )
}

// Maquette .v96-execution-shell: the filter grid over the session's event
// rows (execution-log.ts maps the native observability spans onto them).
export function ModeExecutionSurface(props: { mode: WorkspaceDestination; events: readonly ExecutionEvent[] | undefined }): JSX.Element {
  const language = useLanguage()
  const workbench = useWorkspaceWorkbench()
  const [filter, setFilter] = createSignal<ExecutionFilter>("all")
  const statusLabel = (status: string) =>
    status === "failed" || status === "aborted" ? language.t(`inspector.execution.status.${status}`) : language.t("inspector.execution.status.finished")
  const browserActivity = workbench.browserActivity
  const rows = createMemo(() => {
    const events = props.mode === "browser" ? [...(props.events ?? []), ...browserExecutionEvents(browserActivity())] : props.events ?? []
    return executionRows(events, filter(), statusLabel)
  })
  return (
    <div data-mode-execution={props.mode}>
      <div data-execution-filters>
        <For each={EXECUTION_FILTERS}>
          {(item) => (
            <button type="button" data-execution-filter={item} aria-pressed={filter() === item} onClick={() => setFilter(item)}>
              {language.t(`inspector.execution.filter.${item}`)}
            </button>
          )}
        </For>
      </div>
      <div data-execution-list>
        <Show when={rows().length > 0} fallback={<div data-execution-empty>{language.t("inspector.execution.empty")}</div>}>
          <For each={rows()}>
            {(row) => (
              <div data-execution-row data-status={row.status}>
                <time>{row.time}</time>
                <span data-execution-icon>{row.glyph}</span>
                <div data-execution-copy>
                  <b>{row.title}</b>
                  <span>{row.summary}</span>
                  <small>{row.meta}</small>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
