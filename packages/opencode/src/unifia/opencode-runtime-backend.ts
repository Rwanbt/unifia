import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { WorkspaceID } from "@/control-plane/schema"
import type { OpenCodeRuntimeBackend } from "@unifia/contracts"
import type { RuntimeEvent, SendPromptInput, Session as UnifiaSession } from "@unifia/contracts"

type BusEvent = { type?: string; properties?: Record<string, unknown> }

function toSession(info: Session.Info): UnifiaSession {
  return {
    id: info.id,
    workspaceId: info.workspaceID ?? info.projectID,
    runtimeId: "opencode",
    createdAt: info.time.created,
    messageCount: 0,
  }
}

function toRuntimeEvent(event: BusEvent, sessionId: string): RuntimeEvent {
  const eventType = event.type ?? "opencode.event"
  const type: RuntimeEvent["type"] = eventType.includes("error")
    ? "error"
    : eventType.includes("permission")
      ? "permission"
      : eventType.includes("message") || eventType.includes("part")
        ? "text"
        : "tool-result"
  return { sessionId, type, data: { source: eventType, properties: event.properties ?? {} }, timestamp: Date.now() }
}

/** Concrete OpenCode backend. Policy and audit remain outside this compatibility boundary. */
export class OpenCodeSessionBackend implements OpenCodeRuntimeBackend {
  public async listSessions(workspaceId: string): Promise<UnifiaSession[]> {
    const sessions: UnifiaSession[] = []
    for (const info of Session.list({ workspaceID: WorkspaceID.make(workspaceId) })) sessions.push(toSession(info))
    return sessions
  }

  public async createSession(workspaceId: string): Promise<UnifiaSession> {
    return toSession(await Session.create({ workspaceID: WorkspaceID.make(workspaceId) }))
  }

  public async sendPrompt(input: SendPromptInput): Promise<void> {
    await SessionPrompt.prompt({ sessionID: SessionID.make(input.sessionId), parts: [{ type: "text", text: input.prompt }] })
  }

  public subscribeEvents(sessionId: string): AsyncIterable<RuntimeEvent> {
    const queue: RuntimeEvent[] = []
    const waiters: Array<(result: IteratorResult<RuntimeEvent>) => void> = []
    let closed = false
    const unsubscribe = Bus.subscribeAll((event: BusEvent) => {
      const properties = event.properties ?? {}
      if (properties.sessionID !== sessionId) return
      const next = toRuntimeEvent(event, sessionId)
      const resolve = waiters.shift()
      if (resolve) resolve({ done: false, value: next })
      else queue.push(next)
    })
    const close = () => {
      if (closed) return
      closed = true
      unsubscribe()
      for (const resolve of waiters.splice(0)) resolve({ done: true, value: undefined })
    }
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<RuntimeEvent>> => {
          const next = queue.shift()
          if (next) return Promise.resolve({ done: false, value: next })
          if (closed) return Promise.resolve({ done: true, value: undefined })
          return new Promise((resolve) => waiters.push(resolve))
        },
        return: async (): Promise<IteratorResult<RuntimeEvent>> => {
          close()
          return { done: true, value: undefined }
        },
      }),
    }
  }

  public async cancelSession(sessionId: string): Promise<void> {
    await SessionPrompt.cancel(SessionID.make(sessionId))
  }
}
