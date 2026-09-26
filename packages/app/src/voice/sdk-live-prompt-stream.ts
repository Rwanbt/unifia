/* SPDX-License-Identifier: MIT */
import type { Event } from "@unifia/sdk-shared"
import type { LocalVoiceStreamChunk } from "./local-session"

type EventName = Event["type"]
type EventOf<Name extends EventName> = Extract<Event, { type: Name }>

export interface LocalPromptEventSource {
  on<Name extends EventName>(name: Name, listener: (event: EventOf<Name>) => void): () => void
}

export interface LocalPromptRequest {
  sessionID: string
  messageID: string
  directory: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  parts: Array<{ type: "text"; text: string }>
}

interface PromptStreamState {
  assistantMessageIDs: Set<string>
  textByPart: Map<string, string>
  toolStates: Map<string, string>
  submittedMessageSeen: boolean
  idleSeen: boolean
  finalSent: boolean
}

class AsyncEventQueue<Value> implements AsyncIterableIterator<Value> {
  private values: Value[] = []
  private waiters: Array<(result: IteratorResult<Value>) => void> = []
  private failure: unknown
  private closed = false

  push(value: Value) {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  close() {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  fail(error: unknown) {
    this.failure = error
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  next(): Promise<IteratorResult<Value>> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve({ value, done: false })
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (this.closed) return Promise.resolve({ value: undefined, done: true })
    return new Promise<IteratorResult<Value>>((resolve) => this.waiters.push(resolve)).then((result) => {
      if (result.done && this.failure !== undefined) throw this.failure
      return result
    })
  }

  [Symbol.asyncIterator]() {
    return this
  }
}

/** Streams actual Unifia session events correlated to the submitted user message. */
export function createSdkLivePromptStream(input: {
  events: LocalPromptEventSource
  promptAsync: (request: LocalPromptRequest) => Promise<{ error?: unknown }>
}): (request: LocalPromptRequest & { signal?: AbortSignal }) => AsyncIterable<LocalVoiceStreamChunk> {
  return async function* (request) {
    const queue = new AsyncEventQueue<LocalVoiceStreamChunk>()
    const state: PromptStreamState = {
      assistantMessageIDs: new Set(),
      textByPart: new Map(),
      toolStates: new Map(),
      submittedMessageSeen: false,
      idleSeen: false,
      finalSent: false,
    }
    const unsubscribers = subscribeToPromptEvents(input.events, request, state, queue)
    const onAbort = () => queue.close()
    request.signal?.addEventListener("abort", onAbort, { once: true })
    try {
      if (request.signal?.aborted) return
      const result = await input.promptAsync(request)
      if (result.error) throw result.error
      for await (const chunk of queue) yield chunk
    } finally {
      request.signal?.removeEventListener("abort", onAbort)
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }
}

function subscribeToPromptEvents(
  events: LocalPromptEventSource,
  request: LocalPromptRequest,
  state: PromptStreamState,
  queue: AsyncEventQueue<LocalVoiceStreamChunk>,
) {
  return [
    events.on("message.updated", (event) => onMessageUpdated(event, request, state, queue)),
    events.on("message.part.delta", (event) => onTextDelta(event, request, state, queue)),
    events.on("message.part.updated", (event) => onPartUpdated(event, request, state, queue)),
    events.on("permission.asked", (event) => {
      const tool = event.properties.tool
      if (!tool || !state.assistantMessageIDs.has(tool.messageID)) return
      queue.push({ kind: "permission_required", permission: event.properties.permission, turnID: request.messageID })
    }),
    events.on("session.error", (event) => {
      if (event.properties.sessionID !== request.sessionID || !state.submittedMessageSeen) return
      const name = event.properties.error?.name ?? "SessionError"
      queue.fail(new Error(`Unifia voice session failed: ${name}`))
    }),
    events.on("session.idle", (event) => {
      if (event.properties.sessionID !== request.sessionID || !state.submittedMessageSeen) return
      state.idleSeen = true
      finishPromptStream(request, state, queue)
    }),
  ]
}

function onMessageUpdated(
  event: EventOf<"message.updated">,
  request: LocalPromptRequest,
  state: PromptStreamState,
  queue: AsyncEventQueue<LocalVoiceStreamChunk>,
) {
  const message = event.properties.info
  if (message.role === "user" && message.id === request.messageID) {
    state.submittedMessageSeen = true
    finishPromptStream(request, state, queue)
    return
  }
  if (message.role !== "assistant") return
  if (message.parentID !== request.messageID && !state.assistantMessageIDs.has(message.parentID)) return
  state.assistantMessageIDs.add(message.id)
  if (message.error) queue.fail(new Error(`Unifia voice response failed: ${message.error.name}`))
}

function onTextDelta(
  event: EventOf<"message.part.delta">,
  request: LocalPromptRequest,
  state: PromptStreamState,
  queue: AsyncEventQueue<LocalVoiceStreamChunk>,
) {
  const part = event.properties
  if (!state.assistantMessageIDs.has(part.messageID) || part.field !== "text") return
  state.textByPart.set(part.partID, `${state.textByPart.get(part.partID) ?? ""}${part.delta}`)
  queue.push({ kind: "assistant_text_delta", delta: part.delta, turnID: request.messageID })
}

function onPartUpdated(
  event: EventOf<"message.part.updated">,
  request: LocalPromptRequest,
  state: PromptStreamState,
  queue: AsyncEventQueue<LocalVoiceStreamChunk>,
) {
  const part = event.properties.part
  if (!state.assistantMessageIDs.has(part.messageID)) return
  if (part.type === "text") state.textByPart.set(part.id, part.text)
  if (part.type === "tool") publishToolState(part, request, state, queue)
}

function publishToolState(
  part: Extract<EventOf<"message.part.updated">["properties"]["part"], { type: "tool" }>,
  request: LocalPromptRequest,
  state: PromptStreamState,
  queue: AsyncEventQueue<LocalVoiceStreamChunk>,
) {
  const current = part.state.status
  if (current === state.toolStates.get(part.callID)) return
  state.toolStates.set(part.callID, current)
  if (current === "running") {
    queue.push({ kind: "working", turnID: request.messageID })
    queue.push({ kind: "tool_started", tool: part.tool, turnID: request.messageID })
  }
  if (current === "completed" || current === "error") {
    queue.push({
      kind: "tool_finished",
      tool: part.tool,
      turnID: request.messageID,
      outcome: current === "completed" ? "ok" : "errored",
    })
  }
}

function finishPromptStream(
  request: LocalPromptRequest,
  state: PromptStreamState,
  queue: AsyncEventQueue<LocalVoiceStreamChunk>,
) {
  if (!state.submittedMessageSeen || !state.idleSeen || state.finalSent) return
  state.finalSent = true
  queue.push({
    kind: "assistant_text_final",
    text: [...state.textByPart.values()].join(""),
    turnID: request.messageID,
  })
  queue.close()
}
