/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { LiveRoomGrant } from "@unifia/contracts/speech"
import { AudioCaptureCoordinator } from "./audio-capture-coordinator"
import { DEFAULT_AUDIO_SETTINGS } from "./audio-settings"
import { LiveVoiceController, type LiveRoom, type LiveRoomHandlers, type LocalVoiceTransport } from "./live-controller"
import { LiveHostError, type LiveGrantRequest, type LiveHostClient } from "./live-host"

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
      return { url: "ws://127.0.0.1:7880", token: `t${grants}`, expiresAt: 0, room: "unifia-live-x", binding: "lvb_1", sessionID: request.sessionID ?? null }
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

const context = { directory: "/work/project", sessionID: "ses_1", agent: "build", model: { providerID: "local-llm", modelID: "qwen" } }

describe("LiveVoiceController", () => {
  test("starts the host, requests a grant with the current session and model, opens the mic", async () => {
    const { controller, rooms, requests, prepared, playback } = setup()
    const states: string[] = []
    controller.subscribe((state) => states.push(state))
    await controller.start(context)
    expect(prepared).toEqual(["local"])
    expect(requests[0]).toMatchObject({ directory: "/work/project", sessionID: "ses_1", agent: "build", model: context.model })
    expect(rooms[0].mic).toBe(true)
    expect(playback).toEqual(["start:live-1"])
    expect(controller.state).toBe("connecting")
    rooms[0].handlers!.onAgentAttributes({ "lk.agent.state": "listening" })
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

  test("follows agent state and task attributes through a long task", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    const room = rooms[0].handlers!
    room.onAgentAttributes({ "lk.agent.state": "listening" })
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
    rooms[0].handlers!.onAgentAttributes({ "lk.agent.state": "listening" })
    rooms[0].handlers!.onDisconnected("lost")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests.slice(1).every((request) => request.binding === "lvb_1" && !request.directory)).toBe(true)
    expect(rooms.at(-1)!.mic).toBe(true)
    rooms.at(-1)!.handlers!.onAgentAttributes({ "lk.agent.state": "listening" })
    expect(controller.state).toBe("listening")
  })

  test("transient LiveKit reconnection keeps the conversation", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    rooms[0].handlers!.onAgentAttributes({ "lk.agent.state": "listening" })
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
    expect(released).toEqual(["lvb_1"])
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
    expect(denied.controller.details.error).toBe("microphone_denied")

    const noHost = setup({ grantErrors: [new LiveHostError("voice_host_unavailable")] })
    await noHost.controller.start(context)
    expect(noHost.controller.details.error).toBe("voice_host_unavailable")
  })

  test("an agent that never joins surfaces Voice Host unavailable", async () => {
    const { controller } = setup()
    await controller.start(context)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(controller.details.error).toBe("voice_host_unavailable")
  })

  test("agent-reported errors stop Live with their code", async () => {
    const { controller, rooms } = setup()
    await controller.start(context)
    rooms[0].handlers!.onAgentAttributes({ "unifia.error": "stt_unavailable" })
    expect(controller.details.error).toBe("stt_unavailable")
    expect(rooms[0].disconnected).toBe(true)
  })
})
