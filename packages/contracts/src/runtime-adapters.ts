/* SPDX-License-Identifier: MIT */
import type { RuntimeAdapter, RuntimeEvent, RuntimeInfo, SendPromptInput, Session, WorkspaceScope } from "./runtime.ts"

type SessionState = { session: Session; events: RuntimeEvent[]; history: RuntimeEvent[]; nextSequence: number; waiters: Array<(result: IteratorResult<RuntimeEvent>) => void>; cancelled: boolean }

/** Deterministic adapter used to prove the runtime port without external I/O. */
export class FakeRuntimeAdapter implements RuntimeAdapter {
  private readonly sessions = new Map<string, SessionState>()
  private nextSession = 1
  public constructor(private readonly now: () => number = () => Date.now()) {}
  public async getInfo(): Promise<RuntimeInfo> { return { id: "fake", version: "p3-contract-test", capabilities: [], healthy: true } }
  public async listSessions(scope: WorkspaceScope): Promise<Session[]> {
    return [...this.sessions.values()].filter((state) => state.session.workspaceId === scope.workspaceId).map((state) => ({ ...state.session }))
  }
  public async createSession(input: { workspaceId: string }): Promise<Session> {
    const session: Session = { id: `fake-session-${this.nextSession++}`, workspaceId: input.workspaceId, runtimeId: "fake", createdAt: this.now(), messageCount: 0 }
    this.sessions.set(session.id, { session, events: [], history: [], nextSequence: 1, waiters: [], cancelled: false })
    return { ...session }
  }
  public async sendPrompt(input: SendPromptInput): Promise<void> {
    const state = this.sessions.get(input.sessionId)
    if (!state) throw new Error("session-not-found")
    if (state.cancelled) throw new Error("session-cancelled")
    state.session.messageCount += 1
    this.emit(state, { sessionId: state.session.id, type: "text", data: input.prompt, timestamp: this.now() })
  }
  public subscribeEvents(input: { sessionId: string; afterSequence?: number }): AsyncIterable<RuntimeEvent> {
    const state = this.sessions.get(input.sessionId)
    if (!state) throw new Error("session-not-found")
    const pending = state.history.filter((event) => (event.sequence ?? 0) > (input.afterSequence ?? 0))
    state.events.length = 0
    return { [Symbol.asyncIterator]: () => ({ next: (): Promise<IteratorResult<RuntimeEvent>> => {
      const event = pending.shift() ?? state.events.shift()
      if (event) return Promise.resolve({ done: false, value: event })
      if (state.cancelled) return Promise.resolve({ done: true, value: undefined })
      return new Promise((resolve) => state.waiters.push(resolve))
    } }) }
  }
  public async cancelSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) throw new Error("session-not-found")
    state.cancelled = true
    for (const resolve of state.waiters.splice(0)) resolve({ done: true, value: undefined })
  }
  private emit(state: SessionState, event: RuntimeEvent): void {
    const sequenced = { ...event, sequence: state.nextSequence++ }
    state.history.push(sequenced)
    const resolve = state.waiters.shift()
    if (resolve) resolve({ done: false, value: sequenced })
    else state.events.push(sequenced)
  }
}
export interface OpenCodeRuntimeBackend {
  listSessions(workspaceId: string): Promise<Session[]>
  createSession(workspaceId: string): Promise<Session>
  sendPrompt(input: SendPromptInput): Promise<void>
  subscribeEvents(sessionId: string, afterSequence?: number): AsyncIterable<RuntimeEvent>
  cancelSession(sessionId: string): Promise<void>
}

/** Boundary adapter for the existing OpenCode runtime; all I/O stays in the injected backend. */
export class OpenCodeRuntimeAdapter implements RuntimeAdapter {
  public constructor(private readonly backend: OpenCodeRuntimeBackend, private readonly version: string = "unknown") {}
  public async getInfo(): Promise<RuntimeInfo> {
    return { id: "opencode", version: this.version, capabilities: [], healthy: true }
  }
  public listSessions(scope: WorkspaceScope): Promise<Session[]> { return this.backend.listSessions(scope.workspaceId) }
  public createSession(input: { workspaceId: string }): Promise<Session> { return this.backend.createSession(input.workspaceId) }
  public sendPrompt(input: SendPromptInput): Promise<void> { return this.backend.sendPrompt(input) }
  public subscribeEvents(input: { sessionId: string; afterSequence?: number }): AsyncIterable<RuntimeEvent> { return this.backend.subscribeEvents(input.sessionId, input.afterSequence) }
  public cancelSession(sessionId: string): Promise<void> { return this.backend.cancelSession(sessionId) }
}
export interface UnifiaRuntimeBackend extends OpenCodeRuntimeBackend {}
export class UnifiaRuntimeAdapter implements RuntimeAdapter {
  public constructor(private readonly backend: UnifiaRuntimeBackend, private readonly version: string = "unknown") {}
  public async getInfo(): Promise<RuntimeInfo> { return { id: "unifia", version: this.version, capabilities: [], healthy: true } }
  public listSessions(scope: WorkspaceScope): Promise<Session[]> { return this.backend.listSessions(scope.workspaceId) }
  public createSession(input: { workspaceId: string }): Promise<Session> { return this.backend.createSession(input.workspaceId) }
  public sendPrompt(input: SendPromptInput): Promise<void> { return this.backend.sendPrompt(input) }
  public subscribeEvents(input: { sessionId: string; afterSequence?: number }): AsyncIterable<RuntimeEvent> { return this.backend.subscribeEvents(input.sessionId, input.afterSequence) }
  public cancelSession(sessionId: string): Promise<void> { return this.backend.cancelSession(sessionId) }
}