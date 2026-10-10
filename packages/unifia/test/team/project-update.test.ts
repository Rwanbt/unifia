// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { TeamStore } from "../../src/team/team-store"
import { PROJECT_UPDATE_EVENT } from "../../src/team/project-update"

const PROJECT = "project-update"
const SCOPE = { projectId: PROJECT }

test("ProjectUpdate_QueuedStateAndReopen_PreserveTheSameDurableSnapshot", async () => {
  await using temporary = await tmpdir()
  const filename = path.join(temporary.path, "team.db")
  const store = TeamStore.open(filename)
  try {
    await store.createRun({ runId: "run", planId: "plan", projectId: PROJECT })
    await store.createTask({ runId: "run", taskId: "task", scope: { secret: "do-not-copy" } })
    await store.recordGate({
      runId: "run",
      gateId: "gate",
      verdict: "CHANGES_REQUESTED",
      findings: { secret: "do-not-copy" },
    })
    const change = store.updateTaskStatus("task", "running")
    const snapshot = store.generateProjectUpdate("run", "update", SCOPE)
    await change
    const result = await snapshot
    expect(result?.update.tasks).toEqual({
      total: 1,
      running: 1,
      pending: 0,
      assigned: 0,
      completed: 0,
      blocked: 0,
      cancelled: 0,
    })
    expect(result?.update.reviews).toEqual({ total: 1, changesRequested: 1 })
    expect(JSON.stringify(result)).not.toContain("do-not-copy")
    expect(await store.generateProjectUpdate("missing", "absent", SCOPE)).toBeNull()
    await expect(store.generateProjectUpdate("run", "update", SCOPE)).rejects.toThrow()
    expect(store.count("team_events")).toBe(1)
  } finally {
    store.close()
  }
  const reopened = TeamStore.open(filename)
  try {
    const event = reopened.listEvents("run", SCOPE).items[0]!
    expect(event.kind).toBe(PROJECT_UPDATE_EVENT)
    expect(event.eventId).toBe("update")
    expect((event.payload as { tasks: { running: number } }).tasks.running).toBe(1)
    expect(reopened.integrityCheck().ok).toBe(true)
    expect(reopened.latestProjectUpdate("run", SCOPE)?.update.tasks.running).toBe(1)
    await reopened.appendEvent("run", "later", "task.progress", {})
    expect(reopened.latestProjectUpdate("run", SCOPE)?.eventId).toBe("update")
  } finally {
    reopened.close()
  }
})
