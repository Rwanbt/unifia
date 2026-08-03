/* SPDX-License-Identifier: MIT */
import { promises as fs } from "node:fs"
import path from "node:path"

export const CURRENT_STORAGE_VERSION = 1
const STATE_DIRECTORY = ".unifia"
const STATE_FILE = "workspace-state.json"
const TEMP_FILE = `${STATE_FILE}.tmp`
const BACKUP_FILE = `${STATE_FILE}.bak`

type WorkspaceStateV0 = {
  workspaceId: string
  generation: number
  updatedAt: number
  metadata: Record<string, string>
}

export type WorkspaceState = WorkspaceStateV0 & { schemaVersion: 1 }
export type WorkspaceHealth = {
  healthy: boolean
  rootReadable: boolean
  stateValid: boolean
  recovered: boolean
  generation: number
  problems: string[]
}

function parseState(raw: string): WorkspaceState {
  const value = JSON.parse(raw) as Partial<WorkspaceState> & { schemaVersion?: number }
  if (value.schemaVersion === undefined) return migrateV0(value as WorkspaceStateV0)
  if (value.schemaVersion !== CURRENT_STORAGE_VERSION) throw new Error(`unsupported workspace state version: ${value.schemaVersion}`)
  if (typeof value.workspaceId !== "string" || typeof value.generation !== "number" || typeof value.updatedAt !== "number") {
    throw new Error("invalid workspace state")
  }
  if (!value.metadata || typeof value.metadata !== "object") throw new Error("invalid workspace metadata")
  return { schemaVersion: 1, workspaceId: value.workspaceId, generation: value.generation, updatedAt: value.updatedAt, metadata: { ...value.metadata } }
}

export function migrateV0ToV1(state: WorkspaceStateV0): WorkspaceState {
  return { schemaVersion: 1, ...state, metadata: { ...state.metadata } }
}

export function downgradeV1ToV0(state: WorkspaceState): WorkspaceStateV0 {
  return { workspaceId: state.workspaceId, generation: state.generation, updatedAt: state.updatedAt, metadata: { ...state.metadata } }
}

function migrateV0(state: WorkspaceStateV0): WorkspaceState {
  return migrateV0ToV1(state)
}

function encode(state: WorkspaceState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

export class WorkspaceStorage {
  readonly #root: string
  readonly #stateDirectory: string
  readonly #statePath: string
  readonly #temporaryPath: string
  readonly #backupPath: string
  readonly #now: () => number

  constructor(root: string, now: () => number = Date.now) {
    this.#root = root
    this.#stateDirectory = path.join(root, STATE_DIRECTORY)
    this.#statePath = path.join(this.#stateDirectory, STATE_FILE)
    this.#temporaryPath = path.join(this.#stateDirectory, TEMP_FILE)
    this.#backupPath = path.join(this.#stateDirectory, BACKUP_FILE)
    this.#now = now
  }

  async load(workspaceId: string): Promise<WorkspaceState> {
    const candidates = await this.#readCandidates()
    const matching = candidates.filter((candidate) => candidate.state.workspaceId === workspaceId)
    if (matching.length === 0) return { schemaVersion: 1, workspaceId, generation: 0, updatedAt: this.#now(), metadata: {} }
    const selected = matching.sort((left, right) => right.state.generation - left.state.generation)[0]
    if (selected.path !== this.#statePath) await this.#commit(selected.state)
    return selected.state
  }

  async save(state: WorkspaceState): Promise<WorkspaceState> {
    if (state.schemaVersion !== CURRENT_STORAGE_VERSION) throw new Error("workspace state must use the current schema")
    const next: WorkspaceState = { ...state, generation: state.generation + 1, updatedAt: this.#now(), metadata: { ...state.metadata } }
    await this.#commit(next)
    return next
  }

  async recover(workspaceId: string): Promise<WorkspaceState> {
    return this.load(workspaceId)
  }

  async health(workspaceId: string): Promise<WorkspaceHealth> {
    const problems: string[] = []
    let rootReadable = true
    try { await fs.access(this.#root) } catch { rootReadable = false; problems.push("workspace root is not readable") }
    let stateValid = false
    let recovered = false
    let generation = 0
    try {
      const candidates = await this.#readCandidates()
      const matching = candidates.filter((candidate) => candidate.state.workspaceId === workspaceId)
      if (matching.length > 0) {
        const selected = matching.sort((left, right) => right.state.generation - left.state.generation)[0]
        stateValid = true
        generation = selected.state.generation
        recovered = selected.path !== this.#statePath
      } else {
        problems.push("workspace state is missing")
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "workspace state is invalid")
    }
    return { healthy: rootReadable && stateValid && problems.length === 0, rootReadable, stateValid, recovered, generation, problems }
  }

  async #readCandidates(): Promise<Array<{ path: string; state: WorkspaceState }>> {
    const candidates: Array<{ path: string; state: WorkspaceState }> = []
    for (const candidatePath of [this.#statePath, this.#temporaryPath, this.#backupPath]) {
      try {
        candidates.push({ path: candidatePath, state: parseState(await fs.readFile(candidatePath, "utf8")) })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue
      }
    }
    return candidates
  }

  async #commit(state: WorkspaceState): Promise<void> {
    await fs.mkdir(this.#stateDirectory, { recursive: true })
    const handle = await fs.open(this.#temporaryPath, "w")
    try {
      await handle.writeFile(encode(state), "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.rename(this.#statePath, this.#backupPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    try {
      await fs.rename(this.#temporaryPath, this.#statePath)
    } catch (error) {
      try { await fs.rename(this.#backupPath, this.#statePath) } catch { /* preserve the original failure */ }
      throw error
    }
  }
}