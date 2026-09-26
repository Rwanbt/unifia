/* SPDX-License-Identifier: MIT */
import { createVoiceError, isLiveVoiceError, type LiveRoomGrant, type LiveVoiceError, type VoiceError } from "@unifia/contracts/speech"
import type { AudioSettingsV2 } from "./audio-settings"

export class LiveHostError extends Error {
  readonly voiceError: VoiceError

  constructor(
    readonly code: LiveVoiceError,
  ) {
    const voiceError = createVoiceError(code)
    super(voiceError.detail)
    this.name = "LiveHostError"
    this.voiceError = voiceError
  }
}

export interface LiveGrantRequest {
  binding?: string
  directory?: string
  sessionID?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  language?: AudioSettingsV2["sttLanguage"]
  locale?: string
  voices?: AudioSettingsV2["voiceByLanguage"]
  speed?: number
}

/** Where Live gets its Voice Host and its room credentials. */
export interface LiveHostClient {
  /** Desktop starts (or reuses) the local Voice Host; other runtimes no-op. */
  prepare(settings: AudioSettingsV2): Promise<void>
  requestGrant(request: LiveGrantRequest): Promise<LiveRoomGrant>
  release(binding: string): Promise<void>
}

export interface LiveServer {
  url: string
  authorization?: string
}

/** Keeps the desktop Voice Host warm for a quick restart, then frees its RAM. */
export const HOST_IDLE_STOP_MS = 5 * 60_000

function isLoopbackServer(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1" || hostname === "tauri.localhost"
  } catch {
    return false
  }
}

export function createLiveHostClient(input: {
  platform: "web" | "desktop" | "mobile"
  server: () => LiveServer
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  fetch?: typeof fetch
  idleStopMs?: number
}): LiveHostClient {
  const request = input.fetch ?? ((url: RequestInfo | URL, init?: RequestInit) => fetch(url, init))
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  async function call(method: string, path: string, body?: unknown) {
    const server = input.server()
    try {
      return await request(`${server.url.replace(/\/+$/, "")}/voice/live${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(server.authorization ? { Authorization: server.authorization } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new LiveHostError("connection_lost")
    }
  }

  return {
    async prepare(settings) {
      clearTimeout(idleTimer)
      if (input.platform === "mobile" && isLoopbackServer(input.server().url)) {
        throw new LiveHostError("voice_host_unavailable")
      }
      if (input.platform !== "desktop" || !input.invoke) return
      try {
        await input.invoke("voice_live_start", {
          mode: settings.voiceHostMode,
          cpuProfile: settings.cpuProfile,
          ttsProvider: settings.ttsProvider,
        })
      } catch {
        throw new LiveHostError("voice_host_unavailable")
      }
    },
    async requestGrant(body) {
      const response = await call("POST", "/session", body)
      if (response.ok) return (await response.json()) as LiveRoomGrant
      const detail = (await response.json().catch(() => undefined)) as { error?: string } | undefined
      const code = detail?.error
      if (response.status === 410) throw new LiveHostError("binding_invalid")
      if (response.status === 429) throw new LiveHostError("rate_limited")
      if (isLiveVoiceError(code)) throw new LiveHostError(code)
      if (response.status === 404) throw new LiveHostError("voice_host_unavailable")
      throw new LiveHostError("voice_internal_error")
    },
    async release(binding) {
      await call("DELETE", `/bindings/${encodeURIComponent(binding)}`).catch(() => undefined)
      if (input.platform !== "desktop" || !input.invoke) return
      const invoke = input.invoke
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => void invoke("voice_live_stop").catch(() => undefined), input.idleStopMs ?? HOST_IDLE_STOP_MS)
    },
  }
}
