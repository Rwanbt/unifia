/* SPDX-License-Identifier: MIT */

import { For, Match, Show, Switch, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { ValidateReport } from "./automate-studio-run-bar"

export type AutomateDebugTab = "runs" | "data" | "logs" | "tests" | "problems"

export const AUTOMATE_DEBUG_TABS: readonly AutomateDebugTab[] = ["runs", "data", "logs", "tests", "problems"]

export type AutomateStudioLogLine = {
  readonly at: Date
  readonly level: "info" | "error"
  readonly message: string
}

export type AutomateStudioRun = {
  readonly id: string
  readonly definitionId: string
  readonly status: string
}

/**
 * Debugger under the flow (`.a60-debug`, ADR-086). Runs lists the durable
 * workflow runs, Data edits the local draft, Logs keeps this session's run
 * events, Problems shows the last validation. Tests has no fixture runtime
 * yet and says so.
 */
export function AutomateStudioDebug(props: {
  tab: AutomateDebugTab
  onTab: (tab: AutomateDebugTab) => void
  collapsed: boolean
  onToggle: () => void
  runs: readonly AutomateStudioRun[]
  runsError: boolean
  onCancelRun: (id: string) => void
  draftSource: string
  draftStatus: string
  onDraftInput: (source: string) => void
  onResetDraft: () => void
  hasDefinition: boolean
  logs: readonly AutomateStudioLogLine[]
  problems: ValidateReport | undefined
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const time = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const empty = (key: string) => <div data-automate-debug-empty>{t(key)}</div>
  return (
    <section data-automate-studio-debug data-collapsed={props.collapsed ? "" : undefined}>
      <div data-automate-debug-head role="tablist">
        <For each={AUTOMATE_DEBUG_TABS}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={props.tab === tab}
              data-automate-debug-tab={tab}
              onClick={() => props.onTab(tab)}
            >
              {t(`automate.studio.debug.${tab}`)}
              <Show when={tab === "problems" && (props.problems?.lines.length ?? 0) > 0}>
                <i data-automate-debug-count>{props.problems?.lines.length}</i>
              </Show>
            </button>
          )}
        </For>
        <button
          type="button"
          data-automate-debug-toggle
          aria-expanded={!props.collapsed}
          title={t(props.collapsed ? "automate.studio.debug.expand" : "automate.studio.debug.collapse")}
          aria-label={t(props.collapsed ? "automate.studio.debug.expand" : "automate.studio.debug.collapse")}
          onClick={() => props.onToggle()}
        >
          ⌄
        </button>
      </div>
      <Show when={!props.collapsed}>
        <div data-automate-debug-body>
          <Switch>
            <Match when={props.tab === "runs"}>
              <Show when={!props.runsError} fallback={empty("automate.studio.debug.runsFailed")}>
                <Show when={props.runs.length > 0} fallback={empty("automate.studio.debug.noRuns")}>
                  <ul data-automate-runs>
                    <For each={props.runs}>
                      {(run) => (
                        <li data-automate-run={run.id} data-status={run.status}>
                          <i />
                          <span>{run.definitionId}</span>
                          <small>{run.status}</small>
                          <Show when={run.status === "running" || run.status === "waiting"}>
                            <button type="button" onClick={() => props.onCancelRun(run.id)}>
                              {t("workbench.automate.environment.cancel")}
                            </button>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
            </Match>
            <Match when={props.tab === "data"}>
              <Show when={props.hasDefinition} fallback={empty("automate.studio.debug.noDefinition")}>
                <div data-automate-draft>
                  <div data-automate-draft-head>
                    <span>{props.draftStatus}</span>
                    <button type="button" onClick={() => props.onResetDraft()}>
                      {t("automate.studio.debug.resetDraft")}
                    </button>
                  </div>
                  <textarea
                    spellcheck={false}
                    value={props.draftSource}
                    aria-label={t("automate.studio.debug.draftLabel")}
                    onInput={(event) => props.onDraftInput(event.currentTarget.value)}
                  />
                </div>
              </Show>
            </Match>
            <Match when={props.tab === "logs"}>
              <Show when={props.logs.length > 0} fallback={empty("automate.studio.debug.noLogs")}>
                <ol data-automate-logs>
                  <For each={props.logs}>
                    {(line) => (
                      <li data-level={line.level}>
                        <time>{time(line.at)}</time>
                        <span>{line.message}</span>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            </Match>
            <Match when={props.tab === "tests"}>{empty("automate.studio.debug.noTests")}</Match>
            <Match when={props.tab === "problems"}>
              <Show when={props.problems} fallback={empty("automate.studio.debug.noProblems")}>
                {(report) => (
                  <ul data-automate-studio-run-bar-validate data-ok={report().ok ? "true" : "false"}>
                    <Show when={report().lines.length === 0}>
                      <li data-automate-studio-run-bar-validate-line="ok">{t("workbench.automate.runBar.validateOk")}</li>
                    </Show>
                    <For each={report().lines}>
                      {(line) => <li data-automate-studio-run-bar-validate-line={line.severity}>{line.message}</li>}
                    </For>
                  </ul>
                )}
              </Show>
            </Match>
          </Switch>
        </div>
      </Show>
    </section>
  )
}
