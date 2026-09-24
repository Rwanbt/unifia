/* SPDX-License-Identifier: MIT */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { RoomEvent, Track } from "livekit-client"
import { getStableVoiceDeviceId, LiveKitTransport, type LiveRoom } from "./livekit-transport"
import { installAudioCaptureCoordinator, requestAudioCapture } from "./audio-capture-coordinator"

class FakeRoom implements LiveRoom {
  listeners = new Map<RoomEvent, Array<(...args: any[]) => void>>()
  microphoneChanges: boolean[] = []
  connections: Array<{ url: string; token: string }> = []
  disconnected = false
  localParticipant = {
    setMicrophoneEnabled: async (enabled: boolean) => {
      this.microphoneChanges.push(enabled)
    },
  }

  async connect(url: string, token: string): Promise<void> {
    expect(url).toBe("ws://127.0.0.1:7880")
    this.connections.push({ url, token })
  }

  disconnect(): void {
    this.disconnected = true
  }

  on(event: RoomEvent, listener: (...args: any[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  removeAllListeners(): this {
    this.listeners.clear()
    return this
  }

  emit(event: RoomEvent, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

const grant = {
  url: "ws://127.0.0.1:7880",
  token: "scoped-participant-token",
  roomId: "opaque-room-id",
  sessionId: "session-id",
  deviceId: "device-id",
}

let cleanupCaptureCoordinator: (() => void) | undefined

beforeEach(() => {
  cleanupCaptureCoordinator = installAudioCaptureCoordinator(window)
})

afterEach(() => {
  cleanupCaptureCoordinator?.()
  cleanupCaptureCoordinator = undefined
})

describe("LiveKitTransport", () => {
  test("persists a stable UUID device identity and replaces malformed values", () => {
    const values = new Map<string, string>([["unifia.voice.device-id", "invalid"]])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }

    const first = getStableVoiceDeviceId(storage)
    const second = getStableVoiceDeviceId(storage)

    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    expect(second).toBe(first)
  })

  test("publishes microphone and preserves opaque session identity", async () => {
    const room = new FakeRoom()
    const transport = new LiveKitTransport({
      backend: { start: async () => grant, stop: async () => {} },
      createRoom: () => room,
    })

    await transport.start(grant.sessionId, grant.deviceId)

    expect(transport.state).toBe("connected")
    expect(transport.identity).toEqual({
      sessionId: grant.sessionId,
      deviceId: grant.deviceId,
      roomId: grant.roomId,
    })
    expect(room.microphoneChanges).toEqual([true])
  })

  test("owns the shared microphone for Live and releases it on stop", async () => {
    const stopped: string[] = []
    const dictation = requestAudioCapture(window, "dictation", () => stopped.push("dictation"))!
    const room = new FakeRoom()
    const transport = new LiveKitTransport({
      backend: { start: async () => grant, stop: async () => {} },
      createRoom: () => room,
    })

    try {
      await transport.start(grant.sessionId, grant.deviceId)

      expect(stopped).toEqual(["dictation"])
      expect(dictation.isCurrent()).toBe(false)
      expect(requestAudioCapture(window, "dictation", () => undefined)).toBeUndefined()

      await transport.stop()

      expect(requestAudioCapture(window, "dictation", () => undefined)).toBeDefined()
    } finally {
      await transport.stop()
    }
  })

  test("maps reconnect lifecycle and receives subscribed audio tracks", async () => {
    const room = new FakeRoom()
    const states: string[] = []
    const received: object[] = []
    const transport = new LiveKitTransport({
      backend: { start: async () => grant, stop: async () => {} },
      createRoom: () => room,
      onStateChange: (state) => states.push(state),
      onRemoteAudioTrack: (track) => received.push(track),
    })
    const audioTrack = { kind: Track.Kind.Audio } as any

    await transport.start(grant.sessionId, grant.deviceId)
    room.emit(RoomEvent.Reconnecting)
    room.emit(RoomEvent.Reconnected)
    room.emit(RoomEvent.TrackSubscribed, audioTrack)

    expect(states).toEqual(["connecting", "connected", "reconnecting", "connected"])
    expect(received).toEqual([audioTrack])
  })

  test("refreshes a short-lived token while preserving room and device identity", async () => {
    const room = new FakeRoom()
    let tokenVersion = 0
    const transport = new LiveKitTransport({
      backend: {
        start: async () => ({ ...grant, token: `token-${++tokenVersion}` }),
        stop: async () => {},
      },
      createRoom: () => room,
    })

    await transport.start(grant.sessionId, grant.deviceId)
    room.emit(RoomEvent.Disconnected)
    expect(transport.state).toBe("error")
    await transport.reconnect()

    expect(transport.state).toBe("connected")
    expect(room.connections.map((connection) => connection.token)).toEqual(["token-1", "token-2"])
    expect(transport.identity).toEqual({
      sessionId: grant.sessionId,
      deviceId: grant.deviceId,
      roomId: grant.roomId,
    })
  })

  test("deduplicates finalized turn IDs across reconnect delivery", () => {
    const transport = new LiveKitTransport()
    let deliveries = 0

    expect(transport.acceptFinalizedTurn("turn-1", () => { deliveries++ })).toBe(true)
    expect(transport.acceptFinalizedTurn("turn-1", () => { deliveries++ })).toBe(false)
    expect(deliveries).toBe(1)
  })

  test("keeps finalized turn IDs deduplicated after more than 512 turns", () => {
    const transport = new LiveKitTransport()
    let deliveries = 0

    for (let index = 0; index < 513; index++) {
      expect(transport.acceptFinalizedTurn(`turn-${index}`, () => { deliveries++ })).toBe(true)
    }

    expect(transport.acceptFinalizedTurn("turn-0", () => { deliveries++ })).toBe(false)
    expect(deliveries).toBe(513)
  })

  test("stops capture before releasing the backend session", async () => {
    const room = new FakeRoom()
    const calls: string[] = []
    const transport = new LiveKitTransport({
      backend: {
        start: async () => grant,
        stop: async (sessionId) => { calls.push(sessionId) },
      },
      createRoom: () => room,
    })

    await transport.start(grant.sessionId, grant.deviceId)
    await transport.stop()

    expect(room.microphoneChanges).toEqual([true, false])
    expect(room.disconnected).toBe(true)
    expect(calls).toEqual([grant.sessionId])
    expect(transport.state).toBe("idle")
  })
})
