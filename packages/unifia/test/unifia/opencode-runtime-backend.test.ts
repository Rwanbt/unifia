/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { OpenCodeSessionBackend } from "../../src/unifia/opencode-runtime-backend"
import { tmpdir } from "../fixture/fixture"

// The Workbench routes run outside any project instance. Before the backend
// entered the workspace's instance itself, every call threw "No context found
// for instance" and GET /v1/workspaces/:id/events answered 400 forever.
describe("OpenCodeSessionBackend", () => {
  test("OpenCodeSessionBackend_CalledOutsideAnInstance_ListsAndCreatesInTheWorkspaceDirectory", async () => {
    await using tmp = await tmpdir({ git: true })
    const backend = new OpenCodeSessionBackend((id) => (id === "workspace-a" ? tmp.path : undefined))

    expect(await backend.listSessions("workspace-a")).toEqual([])
    const created = await backend.createSession("workspace-a")
    const listed = await backend.listSessions("workspace-a")
    expect(listed.map((session) => session.id)).toEqual([created.id])
    backend.close()
  })

  test("OpenCodeSessionBackend_WorkspaceNeverOpened_FailsWithAClearError", async () => {
    const backend = new OpenCodeSessionBackend(() => undefined)
    await expect(backend.listSessions("workspace-missing")).rejects.toThrow("has not been opened")
  })
})
