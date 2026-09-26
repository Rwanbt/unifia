/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { LiveRoomGrant } from "@unifia/contracts/speech"
import { AudioCaptureCoordinator } from "./audio-capture-coordinator"
import { DEFAULT_AUDIO_SETTINGS } from "./audio-settings"
import { LiveVoiceController, type LiveRoom, type LiveRoomHandlers, type LocalVoiceTransport } from "./live-controller"
import { LiveHostError, type LiveGrantRequest, type LiveHostClient } from "./live-host"
import type { LocalVoiceStreamChunk } from "./local-session"

const liveBindingId = `lvb_${"1".repeat(32)}`

class FakeRoom implements LiveRoom {
  handlers: LiveRoomHandlers | undefined
  mic = false
  disconnected = false
  constructor(private readonly failWith?: unknown) {}
  async connect(_grant: LiveRoomGrant, handlers: LiveRoomHandlers) {
    if (this.failWith) throw this.failWith
    this.handlers = handlers
  }
  async setMicrophone(enabled: boolean) {
    this.mic = enabled
  }
  async disconnect() {
    this.disconnected = true
  }
}

function setup(options: { roomError?: unknown; grantErrors?: unknown[]; localVoice?: LocalVoiceTransport } = {}) {
  const requests: LiveGrantRequest[] = []
  const released: string[] = []
  const prepared: string[] = []
  let grants = 0
  const host: LiveHostClient = {
    async prepare(settings) {
      prepared.push(settings.voiceHostMode)
    },
    async requestGrant(request) {
      requests.push(request)
      const error = options.grantErrors?.shift()
      if (error) throw error
      grants++
      return { url: "ws://127.0.0.1:7880", token: `t${grants}`, expiresAt: 0, room: "unifia-live-x", binding: liveBindingId, sessionID: request.sessionID ?? null }
    },
    async release(binding) {
      released.push(binding)
    },
  }
  const rooms: FakeRoom[] = []
  const coordinator = new AudioCaptureCoordinator()
  const playback: string[] = []
  const sessions: string[] = []
  const controller = new LiveVoiceController({
    host,
    localVoice: options.localVoice,
    createRoom: () => {
      const room = new FakeRoom(options.roomError)
      rooms.push(room)
      return room
    },
    settings: () => DEFAULT_AUDIO_SETTINGS,
    captureMicrophone: (stop) => coordinator.acquire("live", stop),
    playback: { start: (id) => playback.push(`start:${id}`), end: (id) => playback.push(`end:${id}`) },
    onSession: (id) => sessions.push(id),
    sleep: async () => {},
    agentJoinTimeoutMs: 50,
  })
  return { controller, rooms, requests, released, prepared, coordinator, playback, sessions }
}

function markReady(handlers: LiveRoomHandlers, sessionID = "ses_1") {
  return handlers.onAgentVoiceReady(JSON.stringify({
    kind: "voice_ready",
    sessionID,
    ts: 123,
    seq: 1,
    profile: "live",
  }))
}

const context = { directory: "/work/project", sessionID: "ses_1", agent: "build", model: { providerID: "local-llm", modelID: "qwen" } }

describe("LiveVoiceController", () => {
  test("starts the host, requests a grant with the current session and model, opens the mic", async () => {
    const { controller, rooms, requests, prepared, playback } = setup()
    const states: string[] = []
    controller.subscribe((state) => states.push(state))
    await controller.start(context)
    expect(prepared).toEqual(["local"])
    expect(requests[0]).toMatchObject({ directory: "/work/project", sessionID: "ses_1", agent: "build", model: context.model })
    expect(rooms[0].mic).toBe(false)
    expect(playback).toEqual(["start:live-1"])
    expect(controller.state).toBe("connecting")
    rooms[0].handlers!.onAgentAttributes({ "lk.agent.state": "listening" })
    expect(controller.state).toBe("connecting")
    await markReady(rooms[0].handlers!)
    expect(rooms[0].mic).toBe(true)
    expect(controller.state).toBe("listening")
    expect(states.filter((state, index) => state !== states[index - 1])).toEqual(["idle", "connecting", "listening"])
  })

  test("runs a local Android turn through the existing Unifia session without a host grant", async () => {
    let localHandlers: Parameters<LocalVoiceTransport["start"]>[0] | undefined
    const localCalls: string[] = []
    const localVoice: LocalVoiceTransport = {
      async start(handlers) { localHandlers = handlers; localCalls.push("start") },
      async transcribe(audio) { localCalls.push(`transcribe:${audio}`); return "bonjour" },
      async speak(text) { localCalls.push(`speak:${text}`) },
      stop() { localCalls.push("stop") },
      stopSpeaking() { localCalls.push("stop-speaking") },
    }
    const { controller, requests, prepared, rooms } = setup({ localVoice })
    const prompts: string[] = []
    await controller.start({ ...context, transport: "local", submitTurn: async (text) => { prompts.push(text); return "Bonjour !" } })
    expect(controller.state).toBe("listening")
    expect(requests).toEqual([])
    expect(prepared).toEqual([])
    expect(rooms).toEqual([])
    localHandlers!.onUtterance("wav-data")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(prompts).toEqual(["bonjour"])
    expect(localCalls).toContain("speak:Bonjour !")
    expect(controller.state).toBe("listening")
  })

  test("aborts an in-flight local provider turn when the user interrupts", async () => {
    let localHandlers: Parameters<LocalVoiceTransport["start"]>[0] | undefined
    let promptSignal: AbortSignal | undefined
    const spoken: string[] = []
    const localVoice: LocalVoiceTransport = {
      async start(handlers) { localHandlers = handlers },
      async transcribe() { return "wait" },
      async speak(text) { spoken.push(text) },
      stop() {},
      stopSpeaking() {},
    }
    const { controller } = setup({ localVoice })
    await controller.start({
      ...context,
      transport: "local",
      submitTurn: (_text, signal) => new Promise<string>((_resolve, reject) => {
        promptSignal = signal
        signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })
      }),
    })
    localHandlers!.onUtterance("first")
    await new Promise((resolve) => setTimeout(resolve, 0))
    localHandlers!.onSpeaking(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(promptSignal?.aborted).toBe(true)
    expect(spoken).toEqual([])
    expect(controller.state).toBe("listening")
  })

  test("follows agent state and task attributes through a long task", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    const room = rooms[0].handlers!
    await markReady(room)
    room.onUserSpeaking(true)
    room.onUserSpeaking(false)
    expect(controller.state).toBe("processing")
    room.onAgentAttributes({ "lk.agent.state": "speaking", "unifia.task": "working" })
    expect(controller.state).toBe("speaking")
    room.onAgentAttributes({ "lk.agent.state": "listening" })
    expect(controller.state).toBe("working")
    room.onAgentAttributes({ "unifia.task": "idle" })
    expect(controller.state).toBe("listening")
  })

  test("a session created by the first voice turn is reported once", async () => {
    const { controller, rooms, sessions } = setup()
    await controller.start({ directory: "/work/project" })
    rooms[0].handlers!.onAgentAttributes({ "unifia.session": "ses_new" })
    rooms[0].handlers!.onAgentAttributes({ "unifia.session": "ses_new" })
    expect(sessions).toEqual(["ses_new"])
  })

  test("a full reconnect reuses the binding (same room, device and session)", async () => {
    const { controller, rooms, requests } = setup({ grantErrors: [undefined, new LiveHostError("voice_host_unavailable")] })
    await controller.start(context)
    await markReady(rooms[0].handlers!)
    rooms[0].handlers!.onDisconnected("lost")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests.slice(1).every((request) => request.binding === liveBindingId && !request.directory)).toBe(true)
    expect(rooms.at(-1)!.mic).toBe(false)
    rooms.at(-1)!.handlers!.onAgentAttributes({ "lk.agent.state": "listening" })
    await markReady(rooms.at(-1)!.handlers!)
    expect(rooms.at(-1)!.mic).toBe(true)
    expect(controller.state).toBe("listening")
  })

  test("transient LiveKit reconnection keeps the conversation", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    await markReady(rooms[0].handlers!)
    rooms[0].handlers!.onReconnecting()
    expect(controller.state).toBe("reconnecting")
    rooms[0].handlers!.onReconnected()
    expect(controller.state).toBe("listening")
  })

  test("stop releases the microphone, playback and binding", async () => {
    const { controller, rooms, released, coordinator, playback } = setup()
    await controller.start(context)
    await controller.stop()
    expect(controller.state).toBe("idle")
    expect(rooms[0].disconnected).toBe(true)
    expect(released).toEqual([liveBindingId])
    expect(playback).toEqual(["start:live-1", "end:live-1"])
    // Dictation can take the microphone again immediately.
    expect(coordinator.acquire("dictation", () => {})).toBeDefined()
  })

  test("Live preempts dictation for the microphone", async () => {
    const { controller, coordinator } = setup()
    let dictationStopped = false
    coordinator.acquire("dictation", () => {
      dictationStopped = true
    })
    await controller.start(context)
    expect(dictationStopped).toBe(true)
  })

  test("maps failures to stable error codes", async () => {
    const denied = setup({ roomError: Object.assign(new Error("denied"), { name: "NotAllowedError" }) })
    await denied.controller.start(context)
    expect(denied.controller.state).toBe("error")
    expect(denied.controller.details.error?.legacyCode).toBe("microphone_denied")

    const noHost = setup({ grantErrors: [new LiveHostError("voice_host_unavailable")] })
    await noHost.controller.start(context)
    expect(noHost.controller.details.error?.legacyCode).toBe("voice_host_unavailable")
  })

  test("an agent that never joins surfaces Voice Host unavailable", async () => {
    const { controller } = setup()
    await controller.start(context)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(controller.details.error?.legacyCode).toBe("voice_host_unavailable")
  })

  test("agent-reported errors stop Live with their code", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    rooms[0].handlers!.onAgentAttributes({ "unifia.error": "stt_unavailable" })
    expect(controller.details.error?.legacyCode).toBe("stt_unavailable")
    expect(rooms[0].disconnected).toBe(true)
  })

  test("agent voice_error events validate the envelope and keep raw detail out of UI state", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    rooms[0].handlers!.onAgentVoiceError(JSON.stringify({
        kind: "voice_error",
        sessionID: "ses_1",
        ts: 123,
        seq: 1,
        stage: "stt",
        code: "STT_PROVIDER_UNAVAILABLE",
        detail: "untrusted provider output",
        recoverable: true,
        cause_category: "availability",
      }))
    expect(controller.details.error?.legacyCode).toBe("stt_unavailable")
    expect(controller.details.error?.detail).not.toContain("untrusted")
    await controller.stop()
  })

  test("accepts a pre-session error only when it matches the active binding", async () => {
    const { controller, rooms } = setup()
    await controller.start({ ...context, sessionID: undefined })
    rooms[0].handlers!.onAgentVoiceError(JSON.stringify({
      kind: "voice_error",
      bindingID: liveBindingId,
      ts: 123,
      seq: 0,
      stage: "provider",
      code: "PROVIDER_BINDING_INVALID",
      detail: "The Voice provider binding is invalid.",
      recoverable: false,
      cause_category: "provider",
    }))
    expect(controller.details.error?.code).toBe("PROVIDER_BINDING_INVALID")
    expect(controller.state).toBe("error")
    expect(rooms[0].mic).toBe(false)
  })

  test("rejects malformed readiness and leaves the microphone closed", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    await rooms[0].handlers!.onAgentVoiceReady("not-json")
    expect(controller.state).toBe("error")
    expect(rooms[0].mic).toBe(false)
  })

  test("a late readiness completion cannot reopen the microphone after an error", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    let finish: (() => void) | undefined
    rooms[0].setMicrophone = async (enabled) => {
      if (enabled) await new Promise<void>((resolve) => { finish = resolve })
      rooms[0].mic = enabled
    }
    const pending = rooms[0].handlers!.onAgentVoiceReady(JSON.stringify({
      kind: "voice_ready",
      sessionID: "ses_1",
      ts: 123,
      seq: 1,
      profile: "live",
    }))
    await Promise.resolve()
    rooms[0].handlers!.onAgentVoiceError(JSON.stringify({
      kind: "voice_error",
      sessionID: "ses_1",
      ts: 124,
      seq: 2,
      stage: "stt",
      code: "STT_PROVIDER_UNAVAILABLE",
      detail: "The speech recognition provider is unavailable.",
      recoverable: false,
    }))
    finish?.()
    await pending
    expect(controller.state).toBe("error")
    expect(rooms[0].mic).toBe(false)
  })

  test("malformed agent voice_error events fail with the safe internal code", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    rooms[0].handlers!.onAgentVoiceError("not-json")
    expect(controller.details.error?.legacyCode).toBe("voice_internal_error")
  })

  test("agent voice_error from a different session is rejected", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    rooms[0].handlers!.onAgentVoiceError(JSON.stringify({
      kind: "voice_error",
      sessionID: "ses_other",
      ts: 123,
      seq: 1,
      stage: "stt",
      code: "STT_PROVIDER_UNAVAILABLE",
      detail: "The provider is unavailable.",
      recoverable: false,
      causeCategory: "availability",
    }))
    expect(controller.details.error?.legacyCode).toBe("voice_internal_error")
  })

  /* R6 streaming parity (ADR-060): when the Unifia runtime exposes
     `submitTurnStream`, the controller consumes semantic chunks
     (text deltas, tool lifecycle, permission, errors) instead of
     waiting for a single blocking response. The legacy `submitTurn`
     path is preserved for clients that have not migrated yet. */
  describe("R6 streaming parity (submitTurnStream)", () => {
    function localHandlers(): { current: Parameters<LocalVoiceTransport["start"]>[0] | undefined } {
      return { current: undefined }
    }

    function streamingLocalVoice(spoken: string[], handlersRef: ReturnType<typeof localHandlers>): LocalVoiceTransport {
      return {
        async start(handlers) {
          handlersRef.current = handlers
        },
        async transcribe() {
          return "bonjour"
        },
        async speak(text) {
          spoken.push(text)
        },
        stop() {},
        stopSpeaking() {},
      }
    }

    test("consumes text deltas, accumulates, and speaks the final text", async () => {
      const handlersRef = localHandlers()
      const spoken: string[] = []
      const chunks: LocalVoiceStreamChunk[] = [
        { kind: "thinking", turnID: "t1" },
        { kind: "assistant_text_delta", delta: "Bonjour", turnID: "t1" },
        { kind: "assistant_text_delta", delta: " à tous", turnID: "t1" },
        { kind: "assistant_text_final", text: "Bonjour à tous", turnID: "t1" },
      ]
      const { controller } = setup({ localVoice: streamingLocalVoice(spoken, handlersRef) })
      await controller.start({
        ...context,
        transport: "local",
        submitTurnStream: async function* () {
          for (const chunk of chunks) yield chunk
        },
      })
      const events: string[] = []
      controller.subscribe((state) => events.push(state))
      handlersRef.current!.onUtterance("wav-data")
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(spoken).toEqual(["Bonjour à tous"])
      expect(events.includes("speaking")).toBe(true)
      expect(controller.state).toBe("listening")
    })

    test("forwards tool_started / tool_finished into agent-task=working then idle", async () => {
      const handlersRef = localHandlers()
      const spoken: string[] = []
      const toolEvents: Array<{ type: string; tool?: string }> = []
      const chunks: LocalVoiceStreamChunk[] = [
        { kind: "assistant_text_delta", delta: "Je ", turnID: "t1" },
        { kind: "tool_started", tool: "fs.read", turnID: "t1" },
        { kind: "tool_finished", tool: "fs.read", turnID: "t1", outcome: "ok" },
        { kind: "assistant_text_final", text: "Je sais.", turnID: "t1" },
      ]
      const { controller } = setup({ localVoice: streamingLocalVoice(spoken, handlersRef) })
      await controller.start({
        ...context,
        transport: "local",
        submitTurnStream: async function* () {
          for (const chunk of chunks) yield chunk
        },
      })
      const details: Array<{ task: string }> = []
      controller.subscribe((_state, snapshot) => details.push({ task: snapshot.task }))
      handlersRef.current!.onUtterance("wav-data")
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(details.some((d) => d.task === "working")).toBe(true)
      expect(toolEvents).toEqual([]) // no separate toolEvent channel — task="working" is the projection
      expect(spoken).toEqual(["Je sais."])
    })

    test("permission_required flips attention to permission", async () => {
      const handlersRef = localHandlers()
      const spoken: string[] = []
      const chunks: LocalVoiceStreamChunk[] = [
        { kind: "permission_required", permission: "fs.write:/etc/hosts", turnID: "t1" },
        { kind: "assistant_text_final", text: "OK", turnID: "t1" },
      ]
      const { controller } = setup({ localVoice: streamingLocalVoice(spoken, handlersRef) })
      await controller.start({
        ...context,
        transport: "local",
        submitTurnStream: async function* () {
          for (const chunk of chunks) yield chunk
        },
      })
      handlersRef.current!.onUtterance("wav-data")
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(controller.details.attention).toBe("permission")
    })

    test("mid-stream error chunk fails the controller with a stable code", async () => {
      const handlersRef = localHandlers()
      const spoken: string[] = []
      const chunks: LocalVoiceStreamChunk[] = [
        { kind: "assistant_text_delta", delta: "Partiel ", turnID: "t1" },
        { kind: "error", stage: "llm", code: "rate_limited", detail: "upstream 429" },
      ]
      const { controller } = setup({ localVoice: streamingLocalVoice(spoken, handlersRef) })
      await controller.start({
        ...context,
        transport: "local",
        submitTurnStream: async function* () {
          for (const chunk of chunks) yield chunk
        },
      })
      handlersRef.current!.onUtterance("wav-data")
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(controller.state).toBe("error")
      expect(controller.details.error?.legacyCode).toBe("agent_unavailable")
      expect(spoken).toEqual([])
    })

    test("user interrupt during streaming halts the iterator and skips speak", async () => {
      const handlersRef = localHandlers()
      const spoken: string[] = []
      const seen: string[] = []
      const { controller } = setup({ localVoice: streamingLocalVoice(spoken, handlersRef) })
      await controller.start({
        ...context,
        transport: "local",
        submitTurnStream: async function* (_transcript, signal) {
          seen.push("delta-1")
          yield { kind: "assistant_text_delta", delta: "J'allais", turnID: "t1" }
          // Simulate real LLM streaming latency — gives the user time to interrupt mid-stream.
          await new Promise((resolve) => setTimeout(resolve, 30))
          if (signal?.aborted) return
          seen.push("delta-2")
          yield { kind: "assistant_text_delta", delta: " dire...", turnID: "t1" }
          seen.push("end")
        },
      })
      handlersRef.current!.onUtterance("wav-data")
      // Let the first delta arrive.
      await new Promise((resolve) => setTimeout(resolve, 10))
      handlersRef.current!.onSpeaking(true)
      await new Promise((resolve) => setTimeout(resolve, 80))
      // The generator honoured the abort signal and the controller never spoke partial text.
      expect(spoken).toEqual([])
      expect(seen).toEqual(["delta-1"])
      expect(controller.state).toBe("listening")
    })

    test("legacy submitTurn still works when submitTurnStream is absent", async () => {
      const handlersRef = localHandlers()
      const spoken: string[] = []
      const localVoice: LocalVoiceTransport = {
        async start(handlers) {
          handlersRef.current = handlers
        },
        async transcribe() {
          return "salut"
        },
        async speak(text) {
          spoken.push(text)
        },
        stop() {},
        stopSpeaking() {},
      }
      const { controller } = setup({ localVoice })
      const prompts: string[] = []
      await controller.start({
        ...context,
        transport: "local",
        submitTurn: async (text) => {
          prompts.push(text)
          return "Salut !"
        },
      })
      handlersRef.current!.onUtterance("wav-data")
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(prompts).toEqual(["salut"])
      expect(spoken).toEqual(["Salut !"])
      expect(controller.state).toBe("listening")
    })

    test("late chunks after user interrupt are discarded (no duplicate turn)", async () => {
      const handlersRef = localHandlers()
      const spoken: string[] = []
      const seen: string[] = []
      const { controller } = setup({ localVoice: streamingLocalVoice(spoken, handlersRef) })
      await controller.start({
        ...context,
        transport: "local",
        submitTurnStream: async function* (_transcript, signal) {
          seen.push("delta")
          yield { kind: "assistant_text_delta", delta: "p1", turnID: "t1" }
          await new Promise((resolve) => setTimeout(resolve, 30))
          if (signal?.aborted) return
          seen.push("delta2")
          yield { kind: "assistant_text_delta", delta: "p2", turnID: "t1" }
          await new Promise((resolve) => setTimeout(resolve, 30))
          if (signal?.aborted) return
          seen.push("final")
          yield { kind: "assistant_text_final", text: "p1p2", turnID: "t1" }
        },
      })
      handlersRef.current!.onUtterance("wav-data")
      await new Promise((resolve) => setTimeout(resolve, 10))
      // User starts speaking — bumps revision, aborts the in-flight stream.
      handlersRef.current!.onSpeaking(true)
      await new Promise((resolve) => setTimeout(resolve, 80))
      // The generator stopped at the first signal check and never reached the final chunk;
      // the controller never spoke the partial text. Even if the iterator had emitted more
      // chunks before propagating the abort, the controller's guards would still drop them.
      expect(spoken).toEqual([])
      expect(controller.state).toBe("listening")
      expect(seen.includes("final")).toBe(false)
    })
  })
})
