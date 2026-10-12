/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import {
  createAuthorityStore,
  workflowAuthorityOf,
  type WorkflowAuthority,
  type WorkflowState,
} from "./automate-authority"

// CR05. Before this extraction the only check that a run survives a reload was
// a regular expression over `automate-surface.tsx`'s source text, because the
// decision lived inside the SolidJS component and could not be imported. These
// tests call the code the surface calls.

const token = (workflowRunId: string, generation = 1): WorkflowAuthority => ({
  workflowRunId,
  authorityOwnerId: "owner-1",
  generation,
})

const state = (extra: Record<string, unknown>): WorkflowState => ({
  workflowId: "wf-1",
  status: "running",
  ...extra,
})

function client(body: Record<string, unknown>) {
  const calls: { workspaceId: string; workflowId: string }[] = []
  return {
    calls,
    async reclaimWorkflow(workspaceId: string, workflowId: string) {
      calls.push({ workspaceId, workflowId })
      return { state: state(body) }
    },
  }
}

describe("createAuthorityStore", () => {
  test("a token remembered at start is used without asking the server", async () => {
    const store = createAuthorityStore()
    store.remember(token("run-1"))
    const bridge = client({ authorityToken: token("run-2") })

    const authority = await store.resolve(bridge, "ws-1", "run-1")

    expect(authority.workflowRunId).toBe("run-1")
    expect(bridge.calls).toHaveLength(0)
    expect(store.size).toBe(1)
  })

  test("a cold store reclaims from the server, which is the reload path", async () => {
    // A reload leaves the surface with an empty map and a run it did not start.
    const store = createAuthorityStore()
    const bridge = client({ authorityToken: token("run-9", 4) })

    const authority = await store.resolve(bridge, "ws-1", "run-9")

    expect(bridge.calls).toEqual([{ workspaceId: "ws-1", workflowId: "run-9" }])
    expect(authority).toEqual(token("run-9", 4))
    // And it is kept, so a second cancel of the same run costs nothing.
    expect(store.size).toBe(1)
    await store.resolve(bridge, "ws-1", "run-9")
    expect(bridge.calls).toHaveLength(1)
  })

  test("the reclaimed token is the one the server sent, not a reconstruction", async () => {
    // The generation is a fencing counter; a client that rebuilt the token from
    // the run id alone would drive a run the server considers stale.
    const store = createAuthorityStore()
    const authority = await store.resolve(client({ authorityToken: token("run-3", 7) }), "ws-1", "run-3")

    expect(authority.generation).toBe(7)
  })

  test("no usable token from the server throws instead of faking one", async () => {
    const store = createAuthorityStore()
    // A 403 body, and a state carrying a token of the wrong shape.
    const refused = await store.resolve(client({ status: 403 }), "ws-1", "run-4").catch((error: Error) => error)
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toContain("run-4")

    const malformed = await store
      .resolve(client({ authorityToken: { workflowRunId: "run-5", authorityOwnerId: 7 } }), "ws-1", "run-5")
      .catch((error: Error) => error)
    expect(malformed).toBeInstanceOf(Error)
    expect(store.size).toBe(0)
  })

  test("a refusal from the server propagates rather than being swallowed", async () => {
    const store = createAuthorityStore()
    const bridge = {
      async reclaimWorkflow() {
        throw new Error("workbench request failed: 403")
      },
    }

    await expect(store.resolve(bridge, "ws-1", "run-6")).rejects.toThrow("403")
    expect(store.size).toBe(0)
  })

  test("workflowAuthorityOf reads only a complete token", () => {
    expect(workflowAuthorityOf(state({ authorityToken: token("run-7") }))?.workflowRunId).toBe("run-7")
    expect(workflowAuthorityOf(state({}))).toBeUndefined()
    expect(workflowAuthorityOf(state({ authorityToken: null }))).toBeUndefined()
    expect(workflowAuthorityOf(state({ authorityToken: { workflowRunId: "run-8" } }))).toBeUndefined()
    expect(workflowAuthorityOf(state({ authorityToken: { ...token("run-8"), generation: 1.5 } }))).toBeUndefined()
  })
})
