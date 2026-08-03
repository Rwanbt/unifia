/* SPDX-License-Identifier: MIT */
import type { P3Capability } from "@unifia/contracts"

export type WorkflowStep = { id: string; capability: P3Capability; input: Record<string, unknown>; requiresApproval?: boolean }
export type WorkflowDefinition = { id: string; version: number; workspaceId: string; steps: readonly WorkflowStep[] }
export type WorkflowStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled"
export type WorkflowState = { workflowId: string; definition: WorkflowDefinition; status: WorkflowStatus; nextStep: number; outputs: readonly unknown[]; error?: string }
export type WorkflowStore = { load(id: string): Promise<WorkflowState | undefined>; save(state: WorkflowState): Promise<void> }
export type WorkflowExecutor = { execute(step: WorkflowStep, outputs: readonly unknown[]): Promise<unknown> }
export type WorkflowApproval = { request(workflowId: string, step: WorkflowStep): Promise<boolean> }

export class InMemoryWorkflowStore implements WorkflowStore {
  readonly #states = new Map<string, WorkflowState>()
  async load(id: string): Promise<WorkflowState | undefined> { const state = this.#states.get(id); return state ? structuredClone(state) : undefined }
  async save(state: WorkflowState): Promise<void> { this.#states.set(state.workflowId, structuredClone(state)) }
}

export class WorkflowRuntime {
  readonly #store: WorkflowStore
  readonly #executor: WorkflowExecutor
  readonly #approval: WorkflowApproval
  readonly #switches: { isEngaged(surface: "workflow-automation"): boolean }
  constructor(store: WorkflowStore, executor: WorkflowExecutor, approval: WorkflowApproval, switches: { isEngaged(surface: "workflow-automation"): boolean } = { isEngaged: () => false }) { this.#store = store; this.#executor = executor; this.#approval = approval; this.#switches = switches }
  async start(definition: WorkflowDefinition): Promise<WorkflowState> { if (this.#switches.isEngaged("workflow-automation")) throw new Error("workflow automation is disabled"); if (!definition.id || definition.version < 1) throw new Error("invalid workflow definition"); const state: WorkflowState = { workflowId: definition.id, definition, status: "running", nextStep: 0, outputs: [] }; await this.#store.save(state); return this.resume(definition.id) }
  async resume(id: string): Promise<WorkflowState> { const state = await this.#store.load(id); if (!state) throw new Error("workflow not found"); if (state.status === "completed" || state.status === "cancelled") return state; if (this.#switches.isEngaged("workflow-automation")) { const paused = { ...state, status: "paused" as const }; await this.#store.save(paused); return paused } let current = state; while (current.nextStep < current.definition.steps.length) { const step = current.definition.steps[current.nextStep]!; if (step.requiresApproval && !await this.#approval.request(current.workflowId, step)) { current = { ...current, status: "paused" }; await this.#store.save(current); return current } try { const output = await this.#executor.execute(step, current.outputs); current = { ...current, nextStep: current.nextStep + 1, outputs: [...current.outputs, output], status: "running" }; await this.#store.save(current) } catch (error) { current = { ...current, status: "failed", error: error instanceof Error ? error.message : "workflow step failed" }; await this.#store.save(current); return current } } current = { ...current, status: "completed" }; await this.#store.save(current); return current }
  async cancel(id: string): Promise<WorkflowState> { const state = await this.#store.load(id); if (!state) throw new Error("workflow not found"); const cancelled = { ...state, status: "cancelled" as const }; await this.#store.save(cancelled); return cancelled }
}

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
export class FileWorkflowStore implements WorkflowStore {
  readonly #root: string
  constructor(workspaceRoot: string) { this.#root = resolve(workspaceRoot, ".unifia", "workflows") }
  async load(id: string): Promise<WorkflowState | undefined> { const path = this.#path(id); try { return JSON.parse(await readFile(path, "utf8")) as WorkflowState } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error } }
  async save(state: WorkflowState): Promise<void> { const path = this.#path(state.workflowId); await mkdir(this.#root, { recursive: true }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(state)}\n`, { flag: "wx" }); try { await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error } }
  #path(id: string): string { if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("invalid workflow id"); return join(this.#root, `${id}.json`) }
}
