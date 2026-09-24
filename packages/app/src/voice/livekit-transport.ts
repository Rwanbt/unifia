/* SPDX-License-Identifier: MIT */
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client"
import { invokeTauri } from "../hooks/speech-tauri-adapter"
import { requestAudioCapture, type AudioCaptureLease, type AudioCaptureOwner } from "./audio-capture-coordinator"
import { loadAudioSettings } from "./audio-settings"

export type LiveVoiceState = "idle" | "connecting" | "connected" | "reconnecting" | "error"

export interface LiveVoiceGrant {
  url: string
  token: string
  roomId: string
  sessionId: string
  deviceId: string
}

export interface LiveVoiceBackend {
  start(sessionId: string, deviceId: string): Promise<LiveVoiceGrant>
  stop(sessionId: string): Promise<void>
}

export interface LiveRoom {
  connect(url: string, token: string): Promise<void>
  disconnect(): void
  localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<void>
  }
  on(event: RoomEvent, listener: (...args: any[]) => void): this
  removeAllListeners(): this
}

export interface LiveVoiceTransportOptions {
  backend?: LiveVoiceBackend
  createRoom?: () => LiveRoom
  acquireCapture?: (owner: AudioCaptureOwner, stop: () => void) => AudioCaptureLease | undefined
  onStateChange?: (state: LiveVoiceState) => void
  onRemoteAudioTrack?: (track: RemoteTrack) => void
}

const DEVICE_ID_STORAGE_KEY = "unifia.voice.device-id"

export function getStableVoiceDeviceId(storage: Pick<Storage, "getItem" | "setItem"> = localStorage): string {
  const existing = storage.getItem(DEVICE_ID_STORAGE_KEY)
  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
    return existing
  }
  const deviceId = crypto.randomUUID()
  storage.setItem(DEVICE_ID_STORAGE_KEY, deviceId)
  return deviceId
}

export function createLiveVoiceSessionId(): string {
  return crypto.randomUUID()
}

const defaultBackend: LiveVoiceBackend = {
  start: (sessionId, deviceId) => invokeTauri("live_voice_start", {
    sessionId,
    deviceId,
    voiceHostMode: loadAudioSettings().voiceHostMode,
  }),
  stop: (sessionId) => invokeTauri("live_voice_stop", { sessionId }),
}

export class LiveKitTransport {
  private readonly backend: LiveVoiceBackend
  private readonly createRoom: () => LiveRoom
  private readonly acquireCapture: NonNullable<LiveVoiceTransportOptions["acquireCapture"]>
  private readonly finalizedTurnIds = new Set<string>()
  private captureLease?: AudioCaptureLease
  private grant?: LiveVoiceGrant
  private room?: LiveRoom
  private closing = false
  private reconnecting = false
  private finalizedTurnSessionId?: string
  private currentState: LiveVoiceState = "idle"

  constructor(private readonly options: LiveVoiceTransportOptions = {}) {
    this.backend = options.backend ?? defaultBackend
    this.createRoom = options.createRoom ?? (() => new Room() as LiveRoom)
    this.acquireCapture = options.acquireCapture ?? ((owner, stop) => requestAudioCapture(window, owner, stop))
  }

  get state(): LiveVoiceState {
    return this.currentState
  }

  get identity(): Pick<LiveVoiceGrant, "sessionId" | "deviceId" | "roomId"> | undefined {
    if (!this.grant) return undefined
    const { sessionId, deviceId, roomId } = this.grant
    return { sessionId, deviceId, roomId }
  }

  async start(sessionId: string, deviceId: string): Promise<void> {
    if (this.currentState !== "idle" && this.currentState !== "error") {
      throw new Error("Live voice is already active")
    }
    const captureLease = this.acquireCapture("live", () => {
      void this.stop().catch((error) => {
        this.setState("error")
        console.error("[Live voice] Failed to stop after microphone preemption:", error)
      })
    })
    if (!captureLease) throw new Error("Live voice microphone is already owned by another capture")
    this.captureLease = captureLease
    this.setState("connecting")
    this.closing = false
    try {
      this.grant = await this.backend.start(sessionId, deviceId)
      if (this.finalizedTurnSessionId !== this.grant.sessionId) {
        this.finalizedTurnIds.clear()
        this.finalizedTurnSessionId = this.grant.sessionId
      }
      this.room = this.createRoom()
      this.bindRoomEvents(this.room)
      await this.room.connect(this.grant.url, this.grant.token)
      await this.room.localParticipant.setMicrophoneEnabled(true)
      this.setState("connected")
    } catch (error) {
      try {
        await this.releaseResources()
      } catch {
        // Preserve the connection failure as the actionable cause.
      }
      this.setState("error")
      throw error
    }
  }

  async reconnect(): Promise<void> {
    if (this.reconnecting) return
    const currentGrant = this.grant
    const room = this.room
    if (this.currentState !== "error" || !currentGrant || !room) {
      throw new Error("Live voice has no recoverable room")
    }
    this.reconnecting = true
    this.closing = false
    this.setState("connecting")
    try {
      const refreshed = await this.backend.start(currentGrant.sessionId, currentGrant.deviceId)
      if (refreshed.roomId !== currentGrant.roomId) {
        throw new Error("Live voice reconnect changed the active room")
      }
      this.grant = refreshed
      await room.connect(refreshed.url, refreshed.token)
      await room.localParticipant.setMicrophoneEnabled(true)
      this.setState("connected")
    } catch (error) {
      this.setState("error")
      throw error
    } finally {
      this.reconnecting = false
    }
  }

  async stop(): Promise<void> {
    this.closing = true
    try {
      await this.releaseResources()
    } finally {
      this.setState("idle")
    }
  }

  acceptFinalizedTurn(turnId: string, deliver: () => void): boolean {
    if (!turnId || this.finalizedTurnIds.has(turnId)) return false
    this.finalizedTurnIds.add(turnId)
    deliver()
    return true
  }

  private bindRoomEvents(room: LiveRoom): void {
    room.on(RoomEvent.Reconnecting, () => this.setState("reconnecting"))
    room.on(RoomEvent.Reconnected, () => this.setState("connected"))
    room.on(RoomEvent.Disconnected, () => {
      if (!this.closing) this.setState("error")
    })
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) this.options.onRemoteAudioTrack?.(track)
    })
  }

  private async releaseResources(): Promise<void> {
    const room = this.room
    const grant = this.grant
    this.room = undefined
    this.grant = undefined
    let cleanupError: unknown
    if (room) {
      try {
        await room.localParticipant.setMicrophoneEnabled(false)
      } catch (error) {
        cleanupError = error
      } finally {
        try {
          room.removeAllListeners()
          room.disconnect()
        } catch (error) {
          cleanupError ??= error
        }
      }
    }
    if (grant) {
      try {
        await this.backend.stop(grant.sessionId)
      } catch (error) {
        cleanupError ??= error
      }
    }
    this.captureLease?.release()
    this.captureLease = undefined
    if (cleanupError) throw cleanupError
  }

  private setState(state: LiveVoiceState): void {
    this.currentState = state
    this.options.onStateChange?.(state)
  }
}
