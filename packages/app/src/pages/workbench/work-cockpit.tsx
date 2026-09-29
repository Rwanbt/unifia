/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-cockpit.tsx
//
// The v110 maquette's Work cockpit (`.work65-*`): header, then Plan / Agents /
// Progression / Next safe action / Approvals & blockers / Project update.
// Every figure comes from the real Team projection (runs, tasks, gates).
// Where the backend has no data -- agent roster, run cost, confidence -- the
// card shows an honest empty value, and actions without a backend are shown
// aria-disabled with a "coming soon" tooltip (owner decision 2026-09-22).
// =============================================================================

import { For, Show, type JSX } from "solid-js"
import { Tooltip } from "@unifia/ui/tooltip"
import { wavesFor, type TeamGraphTask } from "@unifia/ui/team-graph"
import { useLanguage } from "@/context/language"
import { WORK_HEALTH_I18N_KEY, type WorkHealth } from "@/pages/workbench/work-health"
import { nextActionableTask } from "@/pages/workbench/work-team"

type Translate = ReturnType<typeof useLanguage>["t"]

export interface WorkGate {
  readonly gateId: string
  readonly taskId: string | null
  readonly verdict: string
}

// Task status -> the board's existing column labels, and the maquette pill
// tone (done / running / neutral).
const STATUS_TONE: Record<string, "done" | "running" | "risk" | undefined> = {
  completed: "done",
  running: "running",
  blocked: "risk",
}

const statusLabel = (t: Translate, status: string) => t(`workbench.work.board.column.${status}` as never)

export function Soon(props: { class?: string; primary?: boolean; label?: string; children: JSX.Element }) {
  const language = useLanguage()
  return (
    <Tooltip placement="top" value={language.t("common.comingSoon")}>
      <button
        type="button"
        data-v110="work-btn"
        data-primary={props.primary ? "" : undefined}
        aria-disabled="true"
        aria-label={props.label}
        class={props.class}
      >
        {props.children}
      </button>
    </Tooltip>
  )
}

export function WorkCockpitHeader(props: {
  title: string
  subtitle: string
  health: WorkHealth
  onNewTask: () => void
  menu: JSX.Element
}) {
  const language = useLanguage()
  const t = language.t
  return (
    <header data-v110="work-top">
      <div data-v110="work-title">
        <h2>{props.title}</h2>
        <p>{props.subtitle}</p>
      </div>
      <span data-v110="work-health" data-work-health={props.health}>
        <i aria-hidden="true" />
        <span>{t(WORK_HEALTH_I18N_KEY[props.health] as never)}</span>
      </span>
      <div class="flex-1" />
      <div data-v110="work-actions">
        <Soon class="work-select">{t("workbench.work.cockpit.autoSafe")} ▾</Soon>
        <Soon>✦ {t("workbench.work.cockpit.planAi")}</Soon>
        <Soon>↶ {t("workbench.work.cockpit.undo")}</Soon>
        {props.menu}
        <button type="button" data-v110="work-btn" data-primary="" onClick={() => props.onNewTask()}>
          ＋ {t("workbench.work.cockpit.newTask")}
        </button>
      </div>
    </header>
  )
}

function CardHead(props: { title: string; children?: JSX.Element }) {
  return (
    <div data-v110="work-card-head">
      <b>{props.title}</b>
      <div class="flex-1" />
      {props.children}
    </div>
  )
}

function TaskRow(props: { task: TeamGraphTask }) {
  const language = useLanguage()
  const t = language.t
  const tone = () => STATUS_TONE[props.task.status]
  return (
    <div data-v110="work-task">
      <div data-v110="work-check" data-tone={tone()}>
        {tone() === "done" ? "✓" : tone() === "running" ? "•" : ""}
      </div>
      <div class="min-w-0">
        <b class="block truncate">{props.task.taskId}</b>
        <small>{t("workbench.work.cockpit.deps", { count: props.task.dependsOn.length })}</small>
      </div>
      <div data-v110="work-task-meta">
        <span data-v110="work-pill" data-tone={tone()}>
          {statusLabel(t, props.task.status)}
        </span>
        <Show when={props.task.status !== "completed"}>
          <Soon label={t("workbench.work.cockpit.run")}>▶</Soon>
        </Show>
      </div>
    </div>
  )
}

export function WorkPlanCard(props: { tasks: readonly TeamGraphTask[]; percent: number }) {
  const language = useLanguage()
  const t = language.t
  const ordered = () => {
    const byId = new Map(props.tasks.map((task) => [task.taskId, task]))
    return wavesFor(props.tasks)
      .flatMap((wave) => wave.taskIds.map((id) => byId.get(id)))
      .filter((task): task is TeamGraphTask => task !== undefined)
  }
  return (
    <section data-v110="work-card">
      <CardHead title={t("workbench.work.planTitle")}>
        <span data-v110="work-card-meta">{props.percent}%</span>
      </CardHead>
      <Show when={props.tasks.length > 0} fallback={<p data-v110="work-empty">{t("workbench.work.planEmpty")}</p>}>
        <div data-v110="work-list">
          <For each={ordered()}>{(task) => <TaskRow task={task} />}</For>
        </div>
      </Show>
    </section>
  )
}

export function WorkAgentsCard() {
  const language = useLanguage()
  const t = language.t
  return (
    <section data-v110="work-card">
      <CardHead title={t("sidebar.work.agents")}>
        <span data-v110="work-card-meta">{t("workbench.work.cockpit.agentsActive", { count: 0 })}</span>
      </CardHead>
      <p data-v110="work-empty">{t("sidebar.work.noAgents")}</p>
    </section>
  )
}

export function WorkProgressCard(props: {
  percent: number
  health: WorkHealth
  taskCount: number
  activeRunCount: number
  gatesReadyCount: number
}) {
  const language = useLanguage()
  const t = language.t
  const stats = () => [
    { value: String(props.taskCount), label: t("workbench.work.cockpit.stat.tasks") },
    { value: String(props.activeRunCount), label: t("workbench.work.cockpit.stat.activeRuns") },
    { value: String(props.gatesReadyCount), label: t("workbench.work.cockpit.stat.gatesReady") },
    { value: "—", label: t("workbench.work.cockpit.stat.cost") },
  ]
  return (
    <section data-v110="work-card">
      <CardHead title={t("workbench.work.progressTitle")}>
        <span data-v110="work-card-meta">{t(WORK_HEALTH_I18N_KEY[props.health] as never)}</span>
      </CardHead>
      <div data-v110="work-card-body">
        <div data-v110="work-progress">
          <i style={{ width: `${props.percent}%` }} />
        </div>
        <div data-v110="work-stat-grid">
          <For each={stats()}>
            {(stat) => (
              <div data-v110="work-stat">
                <b>{stat.value}</b>
                <span>{stat.label}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  )
}

export function WorkNextSafeActionCard(props: { tasks: readonly TeamGraphTask[]; onInspect: () => void }) {
  const language = useLanguage()
  const t = language.t
  const next = () => nextActionableTask(props.tasks)
  return (
    <section data-v110="work-card">
      <CardHead title={t("workbench.work.nextActionTitle")}>
        <Soon>{t("workbench.work.cockpit.policy")}</Soon>
      </CardHead>
      <Show when={next()} fallback={<p data-v110="work-empty">{t("workbench.work.nextActionEmpty")}</p>}>
        {(task) => (
          <div data-v110="work-card-body">
            <h3 data-v110="work-safe-title">{task().taskId}</h3>
            <p data-v110="work-safe-detail">
              {t("workbench.work.cockpit.deps", { count: task().dependsOn.length })} ·{" "}
              {statusLabel(t, task().status)}
            </p>
            <div data-v110="work-reasons">
              <span data-v110="work-reason">✓ {t("workbench.work.cockpit.depsReady")}</span>
            </div>
            <div data-v110="work-safe-actions">
              <button type="button" data-v110="work-btn" onClick={() => props.onInspect()}>
                {t("workbench.work.cockpit.inspect")}
              </button>
              <Soon primary>{t("workbench.work.cockpit.run")}</Soon>
            </div>
          </div>
        )}
      </Show>
    </section>
  )
}

export function WorkApprovalsCard(props: { gates: readonly WorkGate[]; onInspect: () => void }) {
  const language = useLanguage()
  const t = language.t
  const pending = () => props.gates.filter((gate) => gate.verdict === "CHANGES_REQUESTED")
  return (
    <section data-v110="work-card" data-span="">
      <CardHead title={t("workbench.work.cockpit.approvals")}>
        <span data-v110="work-card-meta">{t("workbench.work.cockpit.pending", { count: pending().length })}</span>
      </CardHead>
      <Show when={pending().length > 0} fallback={<p data-v110="work-empty">{t("workbench.work.cockpit.approvalsEmpty")}</p>}>
        <For each={pending()}>
          {(gate) => (
            <div data-v110="work-gate">
              <div class="min-w-0">
                <b>{t("workbench.work.cockpit.gate", { gateId: gate.gateId })}</b>
                <p>{t("workbench.work.cockpit.gateDetail", { taskId: gate.taskId ?? "—", verdict: gate.verdict })}</p>
              </div>
              <div data-v110="work-task-meta">
                <span data-v110="work-pill" data-tone="risk">
                  {t("workbench.work.cockpit.approval")}
                </span>
                <button type="button" data-v110="work-btn" onClick={() => props.onInspect()}>
                  {t("workbench.work.cockpit.inspect")}
                </button>
                <Soon primary>{t("workbench.work.cockpit.approve")}</Soon>
              </div>
            </div>
          )}
        </For>
      </Show>
    </section>
  )
}

export function WorkProjectUpdateCard(props: {
  health: WorkHealth
  percent: number
  completed: number
  total: number
  pending: number
}) {
  const language = useLanguage()
  const t = language.t
  return (
    <section data-v110="work-card" data-span="">
      <CardHead title={t("workbench.work.cockpit.update")}>
        <Soon>{t("workbench.work.cockpit.generateUpdate")}</Soon>
      </CardHead>
      <div data-v110="work-card-body" data-update="">
        <b>{t(WORK_HEALTH_I18N_KEY[props.health] as never)}</b>
        <br />
        {t("workbench.work.cockpit.updateText", {
          percent: props.percent,
          completed: props.completed,
          total: props.total,
          pending: props.pending,
        })}
      </div>
    </section>
  )
}
