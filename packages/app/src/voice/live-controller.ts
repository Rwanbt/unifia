/* SPDX-License-Identifier: MIT */
import { createVoiceError, isLiveVoiceError, type LiveRoomGrant, type LiveVoiceError, type LiveVoiceState, type VoiceError } from "@unifia/contracts/speech"
import type { AudioCaptureLease } from "./audio-capture-coordinator"
import type { AudioSettingsV2 } from "./audio-settings"
import type { LocalVoiceStreamChunk } from "./local-session"
import { LiveHostError, type LiveGrantRequest, type LiveHostClient } from "./live-host"
import { deriveLiveState, INITIAL_LIVE_SNAPSHOT, reduceLive, type AgentPhase, type LiveEvent, type LiveSnapshot } from "./live-state"

export type DisconnectReason = "client" | "lost" | "server"

export interface LiveRoomHandlers {
  onReconnecting(): void
  onReconnected(): void
  onDisconnected(reason: DisconnectReason): void
  onAgentJoined(): void
  onAgentLeft(): void
  onAgentAttributes(attributes: Readonly<Record<string, string>>): void
  onUserSpeaking(speaking: boolean): void
}

export interface LiveRoomOptions {
  inputDeviceId?: string
  outputDeviceId?: string
}

/** Transport seam: implemented with livekit-client, faked in tests. */
export interface LiveRoom {
  connect(grant: LiveRoomGrant, handlers: LiveRoomHandlers, options: LiveRoomOptions): Promise<void>
  setMicrophone(enabled: boolean): Promise<void>
  disconnect(): Promise<void>
}

export interface LiveContext {
  transport?: "host" | "local"
  directory: string
  sessionID?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  locale?: string
  submitTurn?: (transcript: string, signal?: AbortSignal) => Promise<string>
  /** R6 streaming parity (ADR-060). When the Unifia runtime exposes a
   * streaming variant of `prompt`, the controller consumes
   * `assistant_text_delta` / `assistant_text_final` / `tool_*` /
   * `permission_required` chunks instead of waiting for the full
   * response. Optional: legacy clients keep using `submitTurn`. */
  submitTurnStream?: (transcript: string, signal?: AbortSignal) => AsyncIterable<LocalVoiceStreamChunk>
}

export interface LocalVoiceTransport {
  start(handlers: {
    onSpeaking(speaking: boolean): void
    onUtterance(audio: string): void
  }): Promise<void>
  transcribe(audio: string): Promise<string>
  speak(text: string): Promise<void>
  stop(): void
  stopSpeaking(): void
}

export interface LivePlayback {
  start(id: string, stop: () => void): void
  end(id: string): void
}

export interface LiveControllerDeps {
  host: LiveHostClient
  localVoice?: LocalVoiceTransport
  createRoom: () => LiveRoom
  settings: () => AudioSettingsV2
  captureMicrophone: (stop: () => void) => AudioCaptureLease | undefined
  playback: LivePlayback
  onSession?: (sessionID: string) => void
  log?: (message: string, data?: Record<string, unknown>) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  agentJoinTimeoutMs?: number
}

const AGENT_PHASES = new Set<AgentPhase>(["initializing", "idle", "listening", "thinking", "speaking"])
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000]

export function errorFromUnknown(error: unknown): VoiceError {
  if (error instanceof LiveHostError) return error.voiceError
  const name = (error as { name?: string } | null)?.name
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return createVoiceError("microphone_denied")
  if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError") {
    return createVoiceError("microphone_unavailable")
  }
  return createVoiceError("voice_internal_error")
}

/**
 * Owns one Live conversation. Desktop uses the Voice Host and LiveKit binding;
 * standalone Android uses the injected local audio transport and Unifia session.
 * Both paths share state, microphone ownership, playback and cancellation.
 */
export class LiveVoiceController {
  private snapshot: LiveSnapshot = INITIAL_LIVE_SNAPSHOT
  private listeners = new Set<(state: LiveVoiceState, snapshot: LiveSnapshot) => void>()
  private room: LiveRoom | undefined
  private lease: AudioCaptureLease | undefined
  private grant: LiveRoomGrant | undefined
  private context: LiveContext | undefined
  private generation = 0
  private playbackId: string | undefined
  private agentTimer: ReturnType<typeof setTimeout> | undefined
  private localTurnQueue: Promise<void> = Promise.resolve()
  private localTurnAbort: AbortController | undefined
  private localInputRevision = 0

  constructor(private readonly deps: LiveControllerDeps) {}

  get state(): LiveVoiceState {
    return deriveLiveState(this.snapshot)
  }

  get details(): LiveSnapshot {
    return this.snapshot
  }

  get binding(): string | undefined {
    return this.grant?.binding
  }

  subscribe(listener: (state: LiveVoiceState, snapshot: LiveSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.state, this.snapshot)
    return () => this.listeners.delete(listener)
  }

  private dispatch(event: LiveEvent, generation = this.generation) {
    if (generation !== this.generation) return
    const next = reduceLive(this.snapshot, event)
    if (next === this.snapshot) return
    this.snapshot = next
    for (const listener of this.listeners) listener(this.state, this.snapshot)
  }

  private log(message: string, data?: Record<string, unknown>) {
    this.deps.log?.(message, data)
  }

  async start(context: LiveContext): Promise<void> {
    if (this.snapshot.connection !== "idle" && this.snapshot.connection !== "error") return
    const generation = ++this.generation
    this.context = context
    const stale = this.grant?.binding
    this.grant = undefined
    if (stale) void this.deps.host.release(stale)
    this.dispatch({ type: "start" }, generation)
    const startedAt = (this.deps.now ?? Date.now)()
    try {
      const lease = this.deps.captureMicrophone(() => void this.stop())
      if (!lease) throw new LiveHostError("microphone_unavailable")
      this.lease = lease
      if (context.transport === "local") {
        if (!this.deps.localVoice) throw new LiveHostError("voice_host_unavailable")
        if (!context.submitTurnStream && !context.submitTurn) throw new LiveHostError("agent_unavailable")
        this.localInputRevision = 0
        await this.deps.localVoice.start({
          onSpeaking: (speaking) => {
            if (speaking) {
              this.localInputRevision++
              this.deps.localVoice?.stopSpeaking()
              this.localTurnAbort?.abort()
            }
            this.dispatch({ type: "user-speaking", speaking }, generation)
          },
          onUtterance: (audio) => this.queueLocalTurn(audio, generation, this.localInputRevision),
        })
        if (generation !== this.generation) return
        this.dispatch({ type: "connected" }, generation)
        this.dispatch({ type: "agent-state", agent: "listening" }, generation)
        if (!this.playbackId) {
          this.playbackId = `live-${generation}`
          this.deps.playback.start(this.playbackId, () => void this.stop())
        }
        this.log("voice.local.ready.ms", { value: (this.deps.now ?? Date.now)() - startedAt })
        return
      }
      const settings = this.deps.settings()
      await this.deps.host.prepare(settings)
      if (generation !== this.generation) return
      this.grant = await this.deps.host.requestGrant(this.grantRequest(settings))
      if (generation !== this.generation) return
      await this.connect(generation)
      this.log("voice.connect.ms", { value: (this.deps.now ?? Date.now)() - startedAt })
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(errorFromUnknown(error))
    }
  }

  private queueLocalTurn(audio: string, generation: number, inputRevision: number) {
    this.localTurnQueue = this.localTurnQueue.then(async () => {
      if (generation !== this.generation || inputRevision !== this.localInputRevision || !this.deps.localVoice) return
      const context = this.context
      if (!context || (!context.submitTurnStream && !context.submitTurn)) {
        this.fail("agent_unavailable")
        return
      }
      const transcript = (await this.deps.localVoice.transcribe(audio)).trim()
      if (!transcript || generation !== this.generation || inputRevision !== this.localInputRevision) return
      this.dispatch({ type: "user-speaking", speaking: false }, generation)
      this.dispatch({ type: "agent-state", agent: "thinking" }, generation)
      const abort = new AbortController()
      this.localTurnAbort = abort
      try {
        if (context.submitTurnStream) {
          await this.runStreamingLocalTurn(context.submitTurnStream, transcript, abort.signal, generation, inputRevision)
        } else {
          await this.runLegacyLocalTurn(context.submitTurn!, transcript, abort.signal, generation, inputRevision)
        }
        if (this.localTurnAbort === abort) this.localTurnAbort = undefined
      } catch (error) {
        if (abort.signal.aborted) {
          if (this.localTurnAbort === abort) this.localTurnAbort = undefined
          if (generation === this.generation) {
            /* The streaming turn bailed out mid-iteration because the
               user interrupted or the input revision was bumped. Drop
               any partial state we were holding (agent was possibly
               already promoted to "speaking" by a text-delta) and
               return the state machine to "listening" so the UI does
               not get stuck on "speaking" forever. */
            this.dispatch({ type: "agent-task", task: "idle" }, generation)
            this.dispatch({ type: "agent-state", agent: "listening" }, generation)
          }
          return
        }
        if (generation === this.generation) this.fail(errorFromUnknown(error))
      }
      /* If the streaming turn returned without throwing because the
         AbortSignal fired mid-iteration, the inner helper bailed out
         before its post-speak listening dispatch. Detect that here and
         drop back to "listening" so the UI is not stuck on "speaking". */
      if (generation === this.generation && abort.signal.aborted) {
        this.dispatch({ type: "agent-task", task: "idle" }, generation)
        this.dispatch({ type: "agent-state", agent: "listening" }, generation)
      }
    }).catch((error) => {
      if (generation === this.generation) this.fail(errorFromUnknown(error))
    })
  }

  /**
   * R6 streaming parity (ADR-060). Consumes AgentBridge semantic
   * chunks as they arrive — text deltas, tool lifecycle, permission
   * requests — instead of waiting for the full response. The text
   * accumulator is consumed once `assistant_text_final` arrives (or
   * the stream ends) and forwarded to the existing local TTS path,
   * which preserves the deterministic lease/cancellation semantics
   * already proven on the legacy path.
   */
  private async runStreamingLocalTurn(
    submitTurnStream: NonNullable<LiveContext["submitTurnStream"]>,
    transcript: string,
    signal: AbortSignal,
    generation: number,
    inputRevision: number,
  ): Promise<void> {
    const stream = submitTurnStream(transcript, signal)
    let accumulated = ""
    let finalText: string | undefined
    for await (const chunk of stream) {
      if (signal.aborted || generation !== this.generation || inputRevision !== this.localInputRevision) return
      switch (chunk.kind) {
        case "assistant_text_delta":
          accumulated += chunk.delta
          this.dispatch({ type: "agent-text-delta", delta: chunk.delta, turnID: chunk.turnID }, generation)
          if (this.snapshot.agent !== "speaking") this.dispatch({ type: "agent-state", agent: "speaking" }, generation)
          break
        case "assistant_text_final":
          finalText = chunk.text
          this.dispatch({ type: "agent-text-final", text: chunk.text, turnID: chunk.turnID }, generation)
          break
        case "tool_started":
          this.dispatch({ type: "agent-task", task: "working" }, generation)
          this.dispatch({ type: "tool-started", tool: chunk.tool, turnID: chunk.turnID }, generation)
          break
        case "tool_finished":
          this.dispatch({ type: "tool-finished", tool: chunk.tool, turnID: chunk.turnID, outcome: chunk.outcome }, generation)
          break
        case "permission_required":
          this.dispatch({ type: "permission-required", permission: chunk.permission, turnID: chunk.turnID }, generation)
          break
        case "working":
          this.dispatch({ type: "agent-task", task: "working" }, generation)
          break
        case "thinking":
          this.dispatch({ type: "agent-task", task: "thinking" }, generation)
          break
        case "error":
          this.fail("agent_unavailable")
          this.dispatch({ type: "stream-error", stage: chunk.stage, code: chunk.code, detail: chunk.detail }, generation)
          return
      }
    }
    if (signal.aborted || generation !== this.generation || inputRevision !== this.localInputRevision) return
    const text = (finalText ?? accumulated).trim()
    if (!text) {
      this.dispatch({ type: "agent-task", task: "idle" }, generation)
      this.dispatch({ type: "agent-state", agent: "listening" }, generation)
      return
    }
    if (this.snapshot.agent !== "speaking") this.dispatch({ type: "agent-state", agent: "speaking" }, generation)
    await this.deps.localVoice!.speak(text)
    if (generation === this.generation && inputRevision === this.localInputRevision) {
      /* Reset task before going back to listening — `deriveLiveState`
         prioritises `task === "thinking"` over `agent === "listening"`,
         so without an explicit agent-task=idle the UI would stay stuck
         on "thinking" forever (matches the desktop LiveKit pattern
         where the host dispatches `unifia.task=idle` separately). */
      this.dispatch({ type: "agent-task", task: "idle" }, generation)
      this.dispatch({ type: "agent-state", agent: "listening" }, generation)
    }
  }

  /**
   * Legacy path preserved for clients that still expose only the
   * blocking `submitTurn` — same STT → submit → TTS shape as before
   * R6, with the same abort/revision guards. Behaviour is unchanged
   * from the pre-streaming controller, including the `speak` on a
   * complete response (no incremental synthesis).
   */
  private async runLegacyLocalTurn(
    submitTurn: NonNullable<LiveContext["submitTurn"]>,
    transcript: string,
    signal: AbortSignal,
    generation: number,
    inputRevision: number,
  ): Promise<void> {
    const response = (await submitTurn(transcript, signal)).trim()
    if (generation !== this.generation) return
    if (signal.aborted || inputRevision !== this.localInputRevision) {
      this.dispatch({ type: "agent-state", agent: "listening" }, generation)
      return
    }
    if (!response) {
      this.dispatch({ type: "agent-state", agent: "listening" }, generation)
      return
    }
    this.dispatch({ type: "agent-state", agent: "speaking" }, generation)
    await this.deps.localVoice!.speak(response)
    if (generation === this.generation && inputRevision === this.localInputRevision) {
      this.dispatch({ type: "agent-state", agent: "listening" }, generation)
    }
  }

  private grantRequest(settings: AudioSettingsV2): LiveGrantRequest {
    const context = this.context!
    if (this.grant) {
      return { binding: this.grant.binding, agent: context.agent, model: context.model, variant: context.variant }
    }
    return {
      directory: context.directory,
      sessionID: context.sessionID,
      agent: context.agent,
      model: context.model,
      variant: context.variant,
      language: settings.sttLanguage,
      locale: context.locale,
      voices: settings.voiceByLanguage,
      speed: settings.ttsSpeed,
    }
  }

  private async connect(generation: number) {
    const room = this.deps.createRoom()
    this.room = room
    const settings = this.deps.settings()
    await room.connect(this.grant!, this.handlers(generation), {
      inputDeviceId: settings.liveInputDeviceId,
      outputDeviceId: settings.liveOutputDeviceId,
    })
    if (generation !== this.generation) {
      await room.disconnect()
      return
    }
    await room.setMicrophone(true)
    this.dispatch({ type: "connected" }, generation)
    if (!this.playbackId) {
      this.playbackId = `live-${generation}`
      this.deps.playback.start(this.playbackId, () => void this.stop())
    }
    this.armAgentTimer(generation)
  }

  private armAgentTimer(generation: number) {
    clearTimeout(this.agentTimer)
    if (this.snapshot.agent !== "initializing") return
    this.agentTimer = setTimeout(() => {
      if (generation === this.generation && this.snapshot.agent === "initializing") this.fail("voice_host_unavailable")
    }, this.deps.agentJoinTimeoutMs ?? 20_000)
  }

  private handlers(generation: number): LiveRoomHandlers {
    return {
      onReconnecting: () => this.dispatch({ type: "reconnecting" }, generation),
      onReconnected: () => this.dispatch({ type: "reconnected" }, generation),
      onDisconnected: (reason) => {
        if (generation !== this.generation || reason === "client") return
        void this.reconnect(generation)
      },
      onAgentJoined: () => clearTimeout(this.agentTimer),
      onAgentLeft: () => {
        if (generation === this.generation && this.snapshot.connection === "connected") this.fail("agent_unavailable")
      },
      onAgentAttributes: (attributes) => this.applyAgentAttributes(attributes, generation),
      onUserSpeaking: (speaking) => this.dispatch({ type: "user-speaking", speaking }, generation),
    }
  }

  private applyAgentAttributes(attributes: Readonly<Record<string, string>>, generation: number) {
    const phase = attributes["lk.agent.state"] as AgentPhase | undefined
    if (phase && AGENT_PHASES.has(phase)) {
      if (phase !== "initializing") clearTimeout(this.agentTimer)
      this.dispatch({ type: "agent-state", agent: phase }, generation)
    }
    const task = attributes["unifia.task"]
    if (task === "idle" || task === "thinking" || task === "working") this.dispatch({ type: "agent-task", task }, generation)
    if ("unifia.attention" in attributes) {
      const attention = attributes["unifia.attention"]
      this.dispatch({ type: "attention", attention: attention === "permission" || attention === "question" ? attention : undefined }, generation)
    }
    const reportedError = attributes["unifia.error"]
    if (reportedError) {
      this.fail(isLiveVoiceError(reportedError) ? reportedError : "voice_internal_error")
    }
    const session = attributes["unifia.session"]
    if (session?.startsWith("ses_") && this.grant && this.grant.sessionID !== session) {
      this.grant = { ...this.grant, sessionID: session }
      this.deps.onSession?.(session)
    }
  }

  /** Full reconnect after LiveKit gave up resuming: same binding, fresh token. */
  private async reconnect(generation: number) {
    this.dispatch({ type: "reconnecting" }, generation)
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    await this.room?.disconnect().catch(() => undefined)
    for (const delay of RECONNECT_DELAYS_MS) {
      await sleep(delay)
      if (generation !== this.generation) return
      try {
        this.grant = await this.deps.host.requestGrant(this.grantRequest(this.deps.settings()))
        await this.connect(generation)
        this.dispatch({ type: "reconnected" }, generation)
        return
      } catch (error) {
        const voiceError = errorFromUnknown(error)
        if (voiceError.legacyCode === "binding_invalid" || voiceError.legacyCode === "microphone_denied") {
          this.fail(voiceError)
          return
        }
        this.log("voice.reconnect.retry", { code: voiceError.code })
      }
    }
    this.fail("connection_lost")
  }

  private fail(error: LiveVoiceError | VoiceError) {
    const voiceError = typeof error === "string" ? createVoiceError(error) : error
    this.log("voice.live.error", {
      code: voiceError.code,
      stage: voiceError.stage,
      recoverable: voiceError.recoverable,
      causeCategory: voiceError.causeCategory,
    })
    this.teardown()
    this.dispatch({ type: "error", error: voiceError })
  }

  private teardown() {
    clearTimeout(this.agentTimer)
    const room = this.room
    this.room = undefined
    void room?.disconnect().catch(() => undefined)
    this.deps.localVoice?.stop()
    this.deps.localVoice?.stopSpeaking()
    this.localTurnAbort?.abort()
    this.localTurnAbort = undefined
    this.lease?.release()
    this.lease = undefined
    if (this.playbackId) this.deps.playback.end(this.playbackId)
    this.playbackId = undefined
  }

  async stop(): Promise<void> {
    if (this.snapshot.connection === "idle") return
    this.generation++
    const binding = this.grant?.binding
    this.grant = undefined
    this.teardown()
    this.snapshot = INITIAL_LIVE_SNAPSHOT
    for (const listener of this.listeners) listener(this.state, this.snapshot)
    if (binding) await this.deps.host.release(binding)
  }

  /** Clears an error so the button returns to idle. */
  reset() {
    if (this.snapshot.connection !== "error") return
    this.generation++
    this.grant = undefined
    this.snapshot = INITIAL_LIVE_SNAPSHOT
    for (const listener of this.listeners) listener(this.state, this.snapshot)
  }
}
