/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-board-panel.tsx — A5-04
//
// The v110 mockup's Board view, ported onto the real 6-value task status
// enum (no fictional "Review" column — see work-board.ts). Cards show only
// persisted fields: taskId, status, dependency count — no title/description/
// assignee/priority, none of which the server stores (TaskSchema,
// packages/unifia/src/server/routes/team.ts:84-92).
//
// A person may park, release or abandon a task (allowedMoves, mirrored from the
// server rules). Cards drag between the columns that accept them, and a select
// on each card does the same from the keyboard. The server answers every move;
// a refusal is shown, never applied locally.
// =============================================================================

import { For, Show, createSignal, type JSX } from "solid-js"
import { showToast } from "@unifia/ui/toast"
import type { TeamGraphTask } from "@unifia/ui/team-graph"
import { useLanguage } from "@/context/language"
import { tWorkBoard, type WorkBoardKey } from "@/i18n/work-board"
import { allowedMoves, groupByColumn, KANBAN_COLUMNS, type KanbanColumn } from "@/pages/workbench/work-board"

export interface WorkBoardPanelProps {
  readonly tasks: readonly TeamGraphTask[]
  /** Resolves when the server accepted the move, rejects with its refusal. */
  readonly onMove?: (task: TeamGraphTask, to: KanbanColumn) => Promise<void>
}

const REFUSAL_REASONS = ["stale", "not_allowed", "run_closed", "live_dependents"] as const

function refusalKey(error: unknown): WorkBoardKey {
  const reason = (error as { reason?: string } | undefined)?.reason
  const known = REFUSAL_REASONS.find((candidate) => candidate === reason)
  return known ? `move.reason.${known}` : "move.failed"
}

const COLUMN_LABEL_KEY: Record<KanbanColumn, string> = {
  pending: "workbench.work.board.column.pending",
  assigned: "workbench.work.board.column.assigned",
  running: "workbench.work.board.column.running",
  blocked: "workbench.work.board.column.blocked",
  completed: "workbench.work.board.column.completed",
  cancelled: "workbench.work.board.column.cancelled",
}

export function WorkBoardPanel(props: WorkBoardPanelProps): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const board = (key: WorkBoardKey, params?: Record<string, string>) => tWorkBoard(language.locale(), key, params)
  const [dragging, setDragging] = createSignal<TeamGraphTask>()
  const grouping = () => groupByColumn(props.tasks)

  async function move(task: TeamGraphTask, to: KanbanColumn) {
    if (!props.onMove || !allowedMoves(task.status).includes(to)) return
    try {
      await props.onMove(task, to)
    } catch (error) {
      showToast({ variant: "error", title: board("move.failed"), description: board(refusalKey(error)) })
    }
  }

  const accepts = (column: KanbanColumn) => {
    const task = dragging()
    return task !== undefined && allowedMoves(task.status).includes(column)
  }

  return (
    <div data-v110="work-board-panel">
      <Show when={props.tasks.length === 0}>
        <p class="text-12-regular text-text-weak">{t("workbench.work.planEmpty")}</p>
      </Show>
      <div class="grid grid-flow-col auto-cols-[minmax(180px,1fr)] gap-3 overflow-x-auto">
        <For each={KANBAN_COLUMNS}>
          {(column) => (
            <div
              class="rounded-lg border border-border-base bg-background-stronger p-3"
              data-v110="work-board-column"
              data-status={column}
              data-drop-target={accepts(column) ? "true" : undefined}
              onDragOver={(event) => {
                if (accepts(column)) event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                const task = dragging()
                setDragging(undefined)
                if (task) void move(task, column)
              }}
            >
              <h3 class="text-12-medium text-text-weak">{t(COLUMN_LABEL_KEY[column])}</h3>
              <ul class="mt-2 flex flex-col gap-2">
                <For each={grouping()[column]}>
                  {(task) => (
                    <li
                      class="flex items-center gap-2 rounded border border-border-weak-base bg-background-base p-2 text-11-regular"
                      data-v110="work-board-card"
                      data-task-id={task.taskId}
                      draggable={allowedMoves(task.status).length > 0 ? "true" : "false"}
                      onDragStart={() => setDragging(task)}
                      onDragEnd={() => setDragging(undefined)}
                    >
                      <span class="cursor-grab text-text-weaker" aria-hidden="true">⠿</span>
                      <div class="flex flex-col">
                        <span class="text-text-base">{task.taskId}</span>
                        <Show when={task.dependsOn.length > 0}>
                          <span class="text-text-weaker">
                            {t("workbench.work.board.dependencyCount", { count: task.dependsOn.length })}
                          </span>
                        </Show>
                      </div>
                      <Show when={props.onMove && allowedMoves(task.status).length > 0}>
                        <select
                          class="ml-auto rounded border border-border-base bg-background-base px-1 text-11-regular"
                          aria-label={board("move.label", { task: task.taskId })}
                          data-v110="work-board-move"
                          onChange={(event) => {
                            const to = event.currentTarget.value as KanbanColumn
                            event.currentTarget.value = ""
                            if (to) void move(task, to)
                          }}
                        >
                          <option value="">{board("move.placeholder")}</option>
                          <For each={allowedMoves(task.status)}>
                            {(target) => <option value={target}>{t(COLUMN_LABEL_KEY[target])}</option>}
                          </For>
                        </select>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
