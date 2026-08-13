/* SPDX-License-Identifier: MIT */

export type OperationState = "pending" | "running" | "completed" | "cancelled" | "failed"

export type WorkbenchOperation = {
  readonly id: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly createdAt: number
  state: OperationState
  error?: string
}

export class OperationRegistry {
  readonly #operations = new Map<string, WorkbenchOperation>()
  readonly #byIdempotency = new Map<string, string>()
  readonly #nextId: () => string
  readonly #now: () => number

  constructor(nextId: () => string, now: () => number = Date.now) {
    this.#nextId = nextId
    this.#now = now
  }

  start(workspaceId: string, sessionId: string, idempotencyKey?: string): WorkbenchOperation {
    if (idempotencyKey) {
      const existing = this.#byIdempotency.get(idempotencyKey)
      if (existing) return this.#operations.get(existing) as WorkbenchOperation
    }
    const operation: WorkbenchOperation = { id: this.#nextId(), workspaceId, sessionId, createdAt: this.#now(), state: "running" }
    this.#operations.set(operation.id, operation)
    if (idempotencyKey) this.#byIdempotency.set(idempotencyKey, operation.id)
    return operation
  }

  complete(id: string): WorkbenchOperation | undefined {
    const operation = this.#operations.get(id)
    if (!operation || operation.state === "cancelled") return operation
    operation.state = "completed"
    return operation
  }

  fail(id: string, error: unknown): WorkbenchOperation | undefined {
    const operation = this.#operations.get(id)
    if (!operation || operation.state === "cancelled") return operation
    operation.state = "failed"
    operation.error = error instanceof Error ? error.message : "operation failed"
    return operation
  }

  cancel(id: string): WorkbenchOperation | undefined {
    const operation = this.#operations.get(id)
    if (!operation || operation.state === "completed" || operation.state === "failed") return undefined
    operation.state = "cancelled"
    return operation
  }

  get(id: string): WorkbenchOperation | undefined { return this.#operations.get(id) }
}
