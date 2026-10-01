// SPDX-License-Identifier: MIT
import z from "zod"
import type { TeamGateRow, TeamRunRow, TeamTaskRow } from "./team-store"

export const PROJECT_UPDATE_EVENT = "team.project_update" as const
export const ProjectUpdateSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  runId: z.string(),
  runStatus: z.enum(["pending", "running", "completed", "failed", "aborted"]),
  observedAt: z.string(),
  tasks: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    assigned: z.number().int().nonnegative(),
  }),
  reviews: z.object({ total: z.number().int().nonnegative(), changesRequested: z.number().int().nonnegative() }),
})

export function buildProjectUpdate(
  run: TeamRunRow,
  tasks: readonly TeamTaskRow[],
  gates: readonly TeamGateRow[],
  observedAt: string,
) {
  const count = (status: TeamTaskRow["status"]) => tasks.filter((task) => task.status === status).length
  // WHY: gate records are historical review facts, not human-approval requests.
  // Scopes, findings and worker output never enter this public summary.
  return ProjectUpdateSchema.parse({
    schemaVersion: "1.0.0",
    runId: run.runId,
    runStatus: run.status,
    observedAt,
    tasks: {
      total: tasks.length,
      completed: count("completed"),
      running: count("running"),
      blocked: count("blocked"),
      cancelled: count("cancelled"),
      pending: count("pending"),
      assigned: count("assigned"),
    },
    reviews: {
      total: gates.length,
      changesRequested: gates.filter((gate) => gate.verdict === "CHANGES_REQUESTED").length,
    },
  })
}
