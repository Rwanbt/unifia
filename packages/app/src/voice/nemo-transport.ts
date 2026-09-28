/* SPDX-License-Identifier: MIT */
/**
 * nemo-speech transport adapters — the production network side of the
 * real streaming STT provider (campaign §20).
 *
 * WHY a dedicated module: the session protocol lives in
 * `streaming-stt-nemo.ts`; this file owns only wire concerns —
 * endpoint URLs, the buffered WebSocket client, readiness probing and
 * the offline WAV transcription call used to route around the
 * nemo-speech 0.1.0 empty-final defect. Splitting keeps each file
 * inside the size budget and lets tests inject fake sockets without
 * touching URL/format logic.
 *
 * Protocol reference: `.build-temp/g5-streaming/api.md` (captured from
 * nemo-speech 0.1.0 OpenAPI + docs) and the proven bake-off client
 * `scripts/voice/g5_streaming_bakeoff.py`.
 */

import type { StreamingSttConfig } from "@unifia/contracts/streaming-stt"
import { pcmToWav } from "./pcm-buffer"

/** Default loopback endpoint of the locally installed nemo-speech
 *  server (NeMoSpeech installer, ASR model preloaded). */
export const NEMO_DEFAULT_ENDPOINT = "http://127.0.0.1:8137"
export const NEMO_WS_PATH = "/v1/audio/transcriptions/realtime"
export const NEMO_OFFLINE_PATH = "/v1/audio/transcriptions"
export const NEMO_READY_PATH = "/ready"

/** Audio slice handed to the offline route-around call. */
export interface NemoAudio {
  readonly samples: Int16Array
  readonly sampleRateHz: number
}

/** Minimal duplex socket the session protocol drives. Kept narrow so
 *  tests can supply an in-memory fake instead of a real WebSocket. */
export interface NemoSocket {
  send(data: string | Uint8Array): void
  close(): void
  onMessage(handler: (raw: string) => void): void
  onClose(handler: (reason: string) => void): void
  onError(handler: (reason: string) => void): void
}

export type NemoOffline = (
  audio: NemoAudio,
  config: StreamingSttConfig,
  signal: AbortSignal,
) => Promise<string>

/** Injectable dependencies of the streaming provider. `probe` and
 *  `offline` are optional: without them the provider skips the
 *  readiness gate and the empty-final route-around (both are wired by
 *  `nemoDeps()` for production). */
export interface NemoDeps {
  connect(url: string, signal?: AbortSignal): Promise<NemoSocket>
  probe?(endpoint: string, signal?: AbortSignal): Promise<boolean>
  offline?: NemoOffline
}

/** Absolute http(s) endpoint → ws(s) realtime URL. */
export function wsUrl(endpoint: string): string {
  return `${trim(endpoint).replace(/^http/, "ws")}${NEMO_WS_PATH}`
}

/** nemo-speech reports readiness at GET /ready → {"ready": true}. */
export async function nemoProbe(endpoint: string, signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(`${trim(endpoint)}${NEMO_READY_PATH}`, { signal })
  if (!res.ok) return false
  const body = (await res.json()) as { ready?: unknown }
  return body.ready === true
}

/** Offline route-around: POST the whole turn as WAV to the OpenAI
 *  compatible endpoint. Returns "" for silence — the caller decides
 *  whether that is a defect or an honest empty transcript. */
export function nemoOfflineTranscribe(endpoint: string): NemoOffline {
  return async (audio, config, signal) => {
    const form = new FormData()
    form.append(
      "file",
      new Blob([pcmToWav(audio.samples, audio.sampleRateHz)], { type: "audio/wav" }),
      "turn.wav",
    )
    form.append("model", "nvidia/nemotron-3.5-asr-streaming-0.6b")
    form.append("language", config.language)
    form.append("response_format", "json")
    const res = await fetch(`${trim(endpoint)}${NEMO_OFFLINE_PATH}`, {
      method: "POST",
      body: form,
      signal,
    })
    if (!res.ok) throw new Error(`offline transcription failed: HTTP ${res.status}`)
    const body = (await res.json()) as { text?: unknown }
    return typeof body.text === "string" ? body.text : ""
  }
}

/** Production wiring: real WebSocket + readiness probe + offline
 *  route-around against one nemo-speech endpoint. */
export function nemoDeps(endpoint: string = NEMO_DEFAULT_ENDPOINT): NemoDeps {
  return {
    connect: nemoConnect,
    probe: nemoProbe,
    offline: nemoOfflineTranscribe(endpoint),
  }
}

/** Buffered WebSocket client.
 *
 *  WHY the hold queue: the server sends `session.created` immediately
 *  after accept — the provider can only register its message handler
 *  once `connect()` resolves, so frames arriving in that window must
 *  be held, not dropped, or the session handshake deadlocks. */
export function nemoConnect(url: string, signal?: AbortSignal): Promise<NemoSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = "arraybuffer"
    const held: string[] = []
    let sink: { message?: (raw: string) => void; close?: (why: string) => void } = {}
    let dead = ""
    let live = false
    const die = (why: string) => {
      if (dead) return
      dead = why
      sink.close?.(why)
    }
    const leave = () => {
      if (!live) reject(new Error(`nemo-speech websocket connect failed: ${dead || "aborted"}`))
      die(dead || "connect aborted")
      try {
        ws.close()
      } catch {
        // Closing during CONNECTING is best-effort.
      }
    }
    signal?.addEventListener("abort", leave, { once: true })
    ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : ""
      if (sink.message) sink.message(raw)
      else if (raw) held.push(raw)
    }
    ws.onerror = () => {
      if (!live) leave()
      else die("websocket error")
    }
    ws.onclose = (event) => {
      const why = dead || `websocket closed (code ${event.code}${event.reason ? `: ${event.reason}` : ""})`
      if (!live) {
        signal?.removeEventListener("abort", leave)
        reject(new Error(`nemo-speech websocket connect failed: ${why}`))
      }
      die(why)
    }
    ws.onopen = () => {
      live = true
      signal?.removeEventListener("abort", leave)
      resolve({
        send: (data) => {
          if (!dead && ws.readyState === WebSocket.OPEN) ws.send(data)
        },
        close: () => {
          try {
            ws.close()
          } catch {
            // Already closed — idempotent by contract.
          }
        },
        onMessage: (handler) => {
          sink.message = handler
          for (const raw of held.splice(0)) handler(raw)
        },
        onClose: (handler) => {
          sink.close = handler
          if (dead) handler(dead)
        },
        onError: () => {
          // Terminal errors surface through onClose: nemo-speech emits a
          // protocol `error` event and then closes, so one terminal path
          // keeps the state machine single-threaded.
        },
      })
    }
  })
}

const trim = (endpoint: string): string => endpoint.replace(/\/+$/, "")
