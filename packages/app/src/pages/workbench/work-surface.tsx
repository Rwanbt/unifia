/* SPDX-License-Identifier: MIT */

import { Show, createEffect, createMemo, onMount, type JSX } from "solid-js"
import type { TeamGraphTask } from "@unifia/ui/team-graph"
import { useMode } from "@/context/mode"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useTeam } from "@/context/team"
import { useTeamDialog } from "@/context/team-dialog"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { WorkActivityPanel } from "@/pages/workbench/work-activity-panel"
import { createWorkArtifacts, WorkArtifactMenu } from "@/pages/workbench/work-artifact-menu"
import { WorkBoardPanel } from "@/pages/workbench/work-board-panel"
import {
  WorkAgentsCard,
  WorkApprovalsCard,
  WorkCockpitHeader,
  WorkNextSafeActionCard,
  WorkPlanCard,
  WorkProgressCard,
  WorkProjectUpdateCard,
} from "@/pages/workbench/work-cockpit"
import { workHealth } from "@/pages/workbench/work-health"
import { WorkPlanPanel } from "@/pages/workbench/work-plan-panel"
import { WorkRunsPanel } from "@/pages/workbench/work-runs-panel"
import { WorkTimelinePanel } from "@/pages/workbench/work-timeline-panel"
import { pickActiveRun, taskProgress } from "@/pages/workbench/work-team"

const CHANGES_REQUESTED = "CHANGES_REQUESTED"

const basename = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "").split("/").pop() || path

// Everything the cockpit shows, derived from the Team projection of the
// active run (the most relevant one, see pickActiveRun).
function createWorkTeamModel() {
  const team = useTeam()
  onMount(() => {
    void Promise.all([team.runs.refresh(), team.models.refresh()])
  })
  const activeRun = createMemo(() => pickActiveRun(team.runs.page().items))
  createEffect(() => {
    const run = activeRun()
    if (run && team.details.runId() !== run.runId) {
      void team.details.select(run.runId).catch(() => undefined)
    }
  })
  const tasks = createMemo<TeamGraphTask[]>(() => [...team.details.tasks()])
  // Issue #100: the v65 header chip, mapped from real run/task/gate facts
  // (work-health.ts). No run yet is not a problem state — it is "On track",
  // exactly as the mockup computes over an empty task list.
  const health = createMemo(() =>
    workHealth({
      runStatuses: team.runs.page().items.map((run) => run.status),
      taskStatuses: tasks().map((task) => task.status),
      gateVerdicts: team.details.gates().map((gate) => gate.verdict),
    }),
  )
  const countGates = (pending: boolean) =>
    team.details.gates().filter((gate) => (gate.verdict === CHANGES_REQUESTED) === pending).length
  return {
    team,
    tasks,
    progress: createMemo(() => taskProgress(tasks())),
    health,
    activeRunCount: createMemo(() => team.runs.page().items.filter((run) => run.status === "running").length),
    gatesReady: () => countGates(false),
    gatesPending: () => countGates(true),
  }
}

function WorkOverview(props: { model: ReturnType<typeof createWorkTeamModel>; onInspect: () => void }) {
  const m = props.model
  return (
    <div data-v110="work-grid">
      <WorkPlanCard tasks={m.tasks()} percent={m.progress().percent} />
      <WorkAgentsCard />
      <WorkProgressCard
        percent={m.progress().percent}
        health={m.health()}
        taskCount={m.progress().total}
        activeRunCount={m.activeRunCount()}
        gatesReadyCount={m.gatesReady()}
      />
      <WorkNextSafeActionCard tasks={m.tasks()} onInspect={props.onInspect} />
      <WorkApprovalsCard gates={m.team.details.gates()} onInspect={props.onInspect} />
      <WorkProjectUpdateCard
        health={m.health()}
        percent={m.progress().percent}
        completed={m.progress().completed}
        total={m.progress().total}
        pending={m.gatesPending()}
      />
    </div>
  )
}

export function WorkSurface(): JSX.Element {
  const mode = useMode()
  const language = useLanguage()
  const t = language.t
  const layout = useLayout()
  const teamDialog = useTeamDialog()
  const workbench = useWorkspaceWorkbench()
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const model = createWorkTeamModel()
  const artifacts = createWorkArtifacts()
  const view = () => layout.work.view()

  // "Inspect" lands on the run's trajectory, which the inspector's
  // Execution tab already renders.
  const inspectRun = () => {
    layout.inspector.setTab("execution")
    layout.inspector.open()
  }

  return (
    <main data-v110="mode-main" data-component="workbench-mode-main" class="min-w-0 min-h-0 flex-1 flex">
      <section data-v110="surface-card" data-component="workbench-work-surface" class="min-w-0 min-h-0 flex-1 flex flex-col">
        <div data-v110="work-view" data-workbench-surface="work" data-parity="work.surface">
          <WorkCockpitHeader
            title={basename(mode.directory() ?? "") || t("workbench.work.title")}
            subtitle={t("workbench.work.cockpit.subtitle", {
              percent: model.progress().percent,
              completed: model.progress().completed,
              total: model.progress().total,
            })}
            health={model.health()}
            onNewTask={teamDialog.open}
            menu={<WorkArtifactMenu artifacts={artifacts} />}
          />
          <div data-v110="work-content" data-parity="work.content" data-work-view-content={view()}>
            <Show when={workbench.uiPhase() !== "ready"}>
              <div data-v110="work-connection">
                <ConnectionBanner dataAttr="workbench-connection" dataRetryAttr="workbench-retry" />
              </div>
            </Show>
            <Show when={artifacts.message()}>
              <p data-v110="work-connection" data-workbench-export-result={artifacts.state()}>
                {artifacts.message()}
              </p>
            </Show>
            <Show when={view() === "overview"}>
              <WorkOverview model={model} onInspect={inspectRun} />
            </Show>
            <Show when={view() === "tasks"}>
              <WorkPlanPanel
                tasks={model.tasks()}
                percent={model.progress().percent}
                canRead={model.team.capabilities().canRead}
              />
            </Show>
            <Show when={view() === "board"}>
              <WorkBoardPanel tasks={model.tasks()} />
            </Show>
            <Show when={view() === "timeline"}>
              <WorkTimelinePanel />
            </Show>
            <Show when={view() === "activity"}>
              <WorkActivityPanel />
            </Show>
            <Show when={view() === "runs"}>
              <WorkRunsPanel />
            </Show>
          </div>
        </div>
      </section>
    </main>
  )
}
