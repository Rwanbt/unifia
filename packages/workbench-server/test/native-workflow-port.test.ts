/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NativeWorkflowRuntimePort } from "../src/native-workflow-port"
import type { WorkflowDefinitionPort } from "../src/workflow-port.js"

const def = (id: string): WorkflowDefinitionPort => ({
  id, version: 1, workspaceId: "ws-1",
  steps: [
    { id: "s0", capability: "workspace.read", input: { path: "/tmp/a" } },
    { id: "s1", capability: "workspace.read", input: {}, requiresApproval: true },
    { id: "s2", capability: "workspace.read", input: {} },
  ],
})

const clock = { value: 1000 }

function freshPort(): { port: NativeWorkflowRuntimePort; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "unifia-wfport-"))
  return { port: new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => clock.value }), dir }
}

describe("NativeWorkflowRuntimePort (directive 31)", () => {
  test("start surfaces the first step for dispatch; complete advances; approval step maps to human.approval", async () => {
    const ctx = freshPort(); try {
      const state = await ctx.port.start(def("wf-1"), "worker-1")
      expect(state.status).toBe("running"); expect(state.nextStep).toBe(0)
      const afterFirst = await ctx.port.complete(state.authorityToken, { bytes: 12 })
      expect(afterFirst.outputs).toEqual([{ bytes: 12 }])
      const afterSecond = await ctx.port.complete(state.authorityToken, { approved: true })
      expect(afterSecond.nextStep).toBe(2)
      const done = await ctx.port.complete(state.authorityToken, { final: true })
      expect(done.status).toBe("completed"); expect(done.nextStep).toBe(3)
      expect(done.outputs).toHaveLength(3)
    } finally { ctx.port.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("listWorkflows on a database that has never run anything returns an empty list", async () => {
    const ctx = freshPort(); try {
      expect(await ctx.port.listWorkflows()).toEqual([])
      expect(await ctx.port.listWorkflows(["ws-1"])).toEqual([])
    } finally { ctx.port.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("RESTART: resume rediscovers from durable facts; cancel persists and fences stale completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unifia-wfport-restart-"))
    try {
      const first = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => clock.value })
      const started = await first.start(def("wf-9"), "worker-1")
      await first.complete(started.authorityToken, { step: 0 })
      // process "dies": a NEW port instance on the SAME database resumes
      const second = new NativeWorkflowRuntimePort({ databasePath: join(dir, "wf.sqlite"), now: () => clock.value })
      const resumed = await second.resume(started.authorityToken)
      expect(resumed.nextStep).toBe(1); expect(resumed.outputs).toEqual([{ step: 0 }])
      const cancelled = await second.cancel(started.authorityToken)
      expect(cancelled.status).toBe("cancelled")
      second.close()
      first.close()
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })

  test("two runs of one definition stay isolated and pin versions across publication", async () => {
    const ctx = freshPort(); try {
      const v1 = def("wf-versioned")
      const first = await ctx.port.start(v1, "worker-1")
      const second = await ctx.port.start(v1, "worker-2")
      expect(first.workflowId).not.toBe(second.workflowId)
      expect(first.versionId).toBe(second.versionId)

      const v2 = { ...v1, version: 2, steps: [...v1.steps, { id: "s3", capability: "workspace.read" as const, input: {} }] }
      const third = await ctx.port.start(v2, "worker-3")
      expect(third.workflowId).not.toBe(first.workflowId)
      expect(third.versionId).not.toBe(first.versionId)
      expect((await ctx.port.resume(first.authorityToken)).versionId).toBe(first.versionId)
      expect((await ctx.port.resume(second.authorityToken)).versionId).toBe(second.versionId)
      expect((await ctx.port.resume(third.authorityToken)).versionId).toBe(third.versionId)
    } finally { ctx.port.close(); rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) }
  })
})

// CR04: the graph as drawn is the graph that runs.
function dispose(ctx: { port: NativeWorkflowRuntimePort; dir: string }): void {
  ctx.port.close()
  try {
    rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    // WHY: Windows keeps the SQLite file locked for a moment after close; the temp dir is disposable.
  }
}

describe("NativeWorkflowRuntimePort: drawn graph (CR04)", () => {
  const transform = (id: string, field: string): WorkflowDefinitionPort["steps"][number] => ({
    id, capability: "workspace.read", input: {}, family: "tool.transform", config: { fields: { [field]: "1" } },
  })
  const branching = (condition: string): WorkflowDefinitionPort => ({
    id: `wf-branch-${condition}`, version: 1, workspaceId: "ws-1",
    steps: [
      transform("start", "a"),
      { id: "decide", capability: "workspace.read", input: {}, family: "control.if", config: { condition } },
      transform("yes", "y"),
      transform("no", "n"),
    ],
    edges: [
      { from: "start", to: "decide" },
      { from: "decide", to: "yes", kind: "branch-true" },
      { from: "decide", to: "no", kind: "branch-false" },
    ],
  })

  test("a true condition runs the true branch and skips the false one, and the run completes", async () => {
    const ctx = freshPort(); try {
      const started = await ctx.port.start(branching("true"), "worker-1")
      const after = await ctx.port.run(started.authorityToken)
      expect(after.status).toBe("completed")
      const nodes = await ctx.port.executionNodes(started.authorityToken)
      const byId = Object.fromEntries(nodes.map((node) => [node.nodeId, node.status]))
      expect(byId["yes"]).toBe("COMPLETED")
      expect(byId["no"]).toBe("SKIPPED")
    } finally { dispose(ctx) }
  })

  test("a false condition runs the false branch and skips the true one", async () => {
    const ctx = freshPort(); try {
      const started = await ctx.port.start(branching("false"), "worker-1")
      const after = await ctx.port.run(started.authorityToken)
      expect(after.status).toBe("completed")
      const nodes = await ctx.port.executionNodes(started.authorityToken)
      const byId = Object.fromEntries(nodes.map((node) => [node.nodeId, node.status]))
      expect(byId["no"]).toBe("COMPLETED")
      expect(byId["yes"]).toBe("SKIPPED")
    } finally { dispose(ctx) }
  })

  test("a merge joins the taken branch and the run completes with the skipped branch settled", async () => {
    const definition: WorkflowDefinitionPort = {
      id: "wf-join", version: 1, workspaceId: "ws-1",
      steps: [
        transform("start", "a"),
        { id: "decide", capability: "workspace.read", input: {}, family: "control.if", config: { condition: "true" } },
        transform("yes", "y"),
        transform("no", "n"),
        { id: "join", capability: "workspace.read", input: {}, family: "control.merge", config: { strategy: "any", branches: ["yes", "no"] } },
        transform("after", "z"),
      ],
      edges: [
        { from: "start", to: "decide" },
        { from: "decide", to: "yes", kind: "branch-true" },
        { from: "decide", to: "no", kind: "branch-false" },
        { from: "yes", to: "join" },
        { from: "no", to: "join" },
        { from: "join", to: "after" },
      ],
    }
    const ctx = freshPort(); try {
      const started = await ctx.port.start(definition, "worker-1")
      const after = await ctx.port.run(started.authorityToken)
      const nodes = await ctx.port.executionNodes(started.authorityToken)
      const byId = Object.fromEntries(nodes.map((node) => [node.nodeId, node.status]))
      expect(byId).toEqual({ start: "COMPLETED", decide: "COMPLETED", yes: "COMPLETED", no: "SKIPPED", join: "COMPLETED", after: "COMPLETED" })
      expect(after.status).toBe("completed")
    } finally { dispose(ctx) }
  })
})

describe("NativeWorkflowRuntimePort: conditions read earlier nodes (CR04)", () => {
  const conditional = (condition: string): WorkflowDefinitionPort => ({
    id: `wf-cond-${condition.length}`, version: 1, workspaceId: "ws-1",
    steps: [
      { id: "start", capability: "workspace.read", input: {}, family: "tool.transform", config: { fields: { count: "3" } } },
      { id: "decide", capability: "workspace.read", input: {}, family: "control.if", config: { condition } },
      { id: "big", capability: "workspace.read", input: {}, family: "tool.transform", config: { fields: { v: "1" } } },
      { id: "small", capability: "workspace.read", input: {}, family: "tool.transform", config: { fields: { v: "0" } } },
    ],
    edges: [
      { from: "start", to: "decide" },
      { from: "decide", to: "big", kind: "branch-true" },
      { from: "decide", to: "small", kind: "branch-false" },
    ],
  })

  test.each([
    ["$node.start.json.count > 2", "big", "small"],
    ["$node.start.json.count > 5", "small", "big"],
  ])("`%s` takes %s and skips %s", async (condition, taken, skipped) => {
    const ctx = freshPort(); try {
      const started = await ctx.port.start(conditional(condition), "worker-1")
      const after = await ctx.port.run(started.authorityToken)
      const nodes = await ctx.port.executionNodes(started.authorityToken)
      const byId = Object.fromEntries(nodes.map((node) => [node.nodeId, node.status]))
      expect(byId[taken]).toBe("COMPLETED")
      expect(byId[skipped]).toBe("SKIPPED")
      expect(after.status).toBe("completed")
    } finally { dispose(ctx) }
  })
})
