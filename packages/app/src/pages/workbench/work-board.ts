/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-board.ts — A5-04
//
// Pure grouping logic for the Board tab: real tasks sorted into the real
// 6-value task status enum, plus the moves a person may make between columns. The mockup's Board has a "Review" column with no
// server-side counterpart (packages/unifia/src/server/routes/team.ts:87 has
// no such status) — reproducing it here would show a column that can never
// receive a real card, so it's dropped rather than faked.
// =============================================================================

import type { TeamGraphTask } from "@unifia/ui/team-graph"

export const KANBAN_COLUMNS = ["pending", "assigned", "running", "blocked", "completed", "cancelled"] as const

export type KanbanColumn = (typeof KANBAN_COLUMNS)[number]

export type KanbanGrouping = Record<KanbanColumn, TeamGraphTask[]>

export function groupByColumn(tasks: readonly TeamGraphTask[]): KanbanGrouping {
  const grouping: KanbanGrouping = {
    pending: [],
    assigned: [],
    running: [],
    blocked: [],
    completed: [],
    cancelled: [],
  }
  for (const task of tasks) {
    const column = task.status as KanbanColumn
    if (column in grouping) grouping[column].push(task)
  }
  return grouping
}

// Mirror of HUMAN_TASK_TRANSITIONS in packages/unifia/src/team/task-transition.ts
// (the app cannot import from the server package). The server is authoritative:
// this table only decides which drop targets to offer, and a stale copy is
// answered with a 422 rather than an unsafe change.
const HUMAN_MOVES: Readonly<Record<KanbanColumn, readonly KanbanColumn[]>> = {
  pending: ["blocked", "cancelled"],
  assigned: ["blocked", "cancelled"],
  running: ["blocked", "cancelled"],
  blocked: ["pending", "cancelled"],
  completed: [],
  cancelled: [],
}

export function allowedMoves(status: string): readonly KanbanColumn[] {
  return status in HUMAN_MOVES ? HUMAN_MOVES[status as KanbanColumn] : []
}
