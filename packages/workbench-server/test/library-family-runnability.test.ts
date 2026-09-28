/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port"

// The Automate studio adds a library node with an empty `config` (it has no
// config editor). This pins what the real engine does with that node, and is
// the evidence behind RUNNABLE_LIBRARY_FAMILIES in packages/app.
type Outcome = "refused-at-start" | "failed" | "waiting"

async function outcomeOf(family: string): Promise<Outcome> {
  const dir = mkdtempSync(join(tmpdir(), "unifia-family-"))
  const port = new NativeWorkflowRuntimePort({ databasePath: join(dir, "w.sqlite"), now: () => 1000 })
  try {
    let token
    try {
      token = (await port.start({ id: "p", version: 1, workspaceId: "ws", steps: [{ id: "n", family, config: {} } as never] }, "w")).authorityToken
    } catch {
      return "refused-at-start"
    }
    const run = await port.run(token, { authorize: async () => {} })
    return run.status === "failed" ? "failed" : "waiting"
  } finally {
    port.close()
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    } catch {
      // WHY: Windows keeps the SQLite file locked for a moment after close; the temp dir is disposable.
    }
  }
}

const CONTROL = ["control.if", "control.switch", "control.parallel", "control.merge", "control.map", "control.repeat", "control.while", "control.child"]

describe("WorkflowFamilies_EmptyConfig_Outcome", () => {
  test.each(CONTROL)("%s is refused at start", async (family) => {
    expect(await outcomeOf(family)).toBe("refused-at-start")
  })

  test.each(["tool.http", "tool.transform"])("%s fails without a config", async (family) => {
    expect(await outcomeOf(family)).toBe("failed")
  })

  test.each(["trigger.manual", "human.approval", "wait"])("%s waits for its external event", async (family) => {
    expect(await outcomeOf(family)).toBe("waiting")
  })
})
