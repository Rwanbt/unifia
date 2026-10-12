/* SPDX-License-Identifier: MIT */

import type { InspectorCard } from "@/context/mode-inspector"
import type { TeamGraphTask } from "@unifia/ui/team-graph"
import { WORK_HEALTH_I18N_KEY, type WorkHealth } from "./work-health"
import { nextActionableTask, type TaskProgress, type WorkRun } from "./work-team"

type Translate = (key: string, params?: Record<string, string | number>) => string

const KNOWN_RUN_STATUSES: ReadonlySet<string> = new Set(["pending", "running", "completed", "failed", "aborted"])
const KNOWN_TASK_STATUSES: ReadonlySet<string> = new Set(["pending", "assigned", "running", "blocked", "completed", "cancelled"])

const labelled = (t: Translate, prefix: string, known: ReadonlySet<string>, status: string) =>
  known.has(status) ? t(`${prefix}.${status}`) : status

export type WorkInspectorInput = {
  readonly run: WorkRun | undefined
  readonly tasks: readonly TeamGraphTask[]
  readonly progress: TaskProgress
  readonly health: WorkHealth
}

/** What the inspector shows for Work: the active run's facts and its next task, from the Team projection. */
export function workInspectorCards(input: WorkInspectorInput, t: Translate): readonly InspectorCard[] {
  const { run } = input
  if (!run) return [{ title: t("inspector.empty.title"), description: t("inspector.empty.description") }]
  const cards: InspectorCard[] = [
    {
      title: run.runId,
      rows: [
        { label: t("inspector.work.status"), value: labelled(t, "team.runStatus", KNOWN_RUN_STATUSES, run.status) },
        { label: t("inspector.work.health"), value: t(WORK_HEALTH_I18N_KEY[input.health]) },
        { label: t("workbench.work.progressTitle"), value: `${input.progress.completed}/${input.progress.total} · ${input.progress.percent}%` },
      ],
    },
  ]
  const next = nextActionableTask(input.tasks, run.status)
  if (next) {
    cards.push({
      title: t("workbench.work.nextActionTitle"),
      rows: [
        { label: t("inspector.work.task"), value: next.taskId },
        { label: t("inspector.work.status"), value: labelled(t, "workbench.work.board.column", KNOWN_TASK_STATUSES, next.status) },
        { label: t("inspector.work.dependencies"), value: String(next.dependsOn.length) },
      ],
    })
  }
  return cards
}
