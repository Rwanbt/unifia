/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileWorkflowStore, InMemoryWorkflowStore, WorkflowRuntime } from "../src/index.ts"
let approved = false
let stopped = false
const outputs: string[] = []
const runtime = new WorkflowRuntime(new InMemoryWorkflowStore(), { execute: async (step) => { outputs.push(step.id); return `done:${step.id}` } }, { request: async () => approved }, { isEngaged: () => stopped })
const definition = { id: "wf-1", version: 1, workspaceId: "ws-1", steps: [{ id: "prepare", capability: "workspace.read", input: {} }, { id: "publish", capability: "artifact.export", input: {}, requiresApproval: true }] as const }
let state = await runtime.start(definition)
assert.equal(state.status, "paused"); assert.equal(state.nextStep, 1); assert.deepEqual(outputs, ["prepare"])
approved = true; state = await runtime.resume("wf-1"); assert.equal(state.status, "completed"); assert.equal(state.nextStep, 2)
stopped = true; state = await runtime.resume("wf-1"); assert.equal(state.status, "completed")
console.log("WorkflowRuntime: 4/4 passed")

const persistedRoot = await mkdtemp(join(tmpdir(), "unifia-workflow-"))
const persisted = new FileWorkflowStore(persistedRoot)
await persisted.save({ workflowId: "persisted-1", definition: { id: "persisted-1", version: 1, workspaceId: "ws", steps: [] }, status: "paused", nextStep: 0, outputs: [] })
assert.equal((await persisted.load("persisted-1"))?.status, "paused")
await rm(persistedRoot, { recursive: true, force: true })
console.log("FileWorkflowStore: 1/1 passed")