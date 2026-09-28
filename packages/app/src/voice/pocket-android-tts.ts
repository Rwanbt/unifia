/* SPDX-License-Identifier: MIT */
/**
 * Pocket TTS on Android — the router's primary local neural voice (ADR-062,
 * G7). The synthesis runs natively in `libpocket_tts.so` (PocketTTS.cpp over
 * the bundled ONNX Runtime) behind the `voice_pocket_*` commands in
 * `src-tauri/src/voice/pocket_tts.rs`; this backend only streams its PCM.
 *
 * A language speaks only when its Pocket pack is installed on the device.
 * A missing pack is a non-recoverable MODEL_MISSING error — Android never
 * substitutes another engine.
 */

import type { SpeechLanguage } from "@unifia/contracts/speech"
import {
  TTS_ERROR_CODES,
  TTS_LANGUAGES,
  type TtsAudioChunk,
  type TtsBackend,
  type TtsCapabilities,
  type TtsConfig,
  type TtsProviderError,
} from "@unifia/contracts/tts-router"

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

const RESPONSE_HEADER_BYTES = 4

/** Measured on the Xiaomi Mi 10 Pro, int8, 2 threads, warm voice: 93 ms. */
const MEASURED_TTFA_MS = 93

const CAPABILITIES: TtsCapabilities = {
  providerId: "pocket",
  languages: TTS_LANGUAGES,
  productionReady: true,
  streaming: true,
  voiceCloning: false,
  cpuOnly: true,
  remoteCapable: false,
  ttfaMs: MEASURED_TTFA_MS,
  chunkCadenceMs: 80,
}

const NATIVE_ERROR_CODES: ReadonlyArray<readonly [prefix: string, code: string, recoverable: boolean]> = [
  ["POCKET_MODEL_MISSING", TTS_ERROR_CODES.MODEL_MISSING, false],
  ["POCKET_MODEL_LOAD_FAILED", TTS_ERROR_CODES.MODEL_LOAD_FAILED, false],
  ["POCKET_UNAVAILABLE", TTS_ERROR_CODES.PROVIDER_OFFLINE, false],
  ["POCKET_FAILED", TTS_ERROR_CODES.MODEL_LOAD_FAILED, true],
]

function nativeError(error: unknown): { code: string; recoverable: boolean; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const match = NATIVE_ERROR_CODES.find(([prefix]) => message.startsWith(prefix))
  return { code: match?.[1] ?? TTS_ERROR_CODES.MODEL_LOAD_FAILED, recoverable: match?.[2] ?? true, message }
}

/** Decodes `u32 LE sample rate || PCM16 LE mono`; a zero rate ends the stream. */
export function decodePocketChunk(response: unknown): { sampleRateHz: number; samples: Int16Array } {
  const buffer = response instanceof ArrayBuffer
    ? response
    : ArrayBuffer.isView(response)
      ? response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength)
      : Array.isArray(response)
        ? new Uint8Array(response as number[]).buffer
        : undefined
  if (!buffer || buffer.byteLength < RESPONSE_HEADER_BYTES) throw new Error("POCKET_FAILED: malformed native chunk")
  const view = new DataView(buffer)
  const sampleRateHz = view.getUint32(0, true)
  const count = Math.floor((buffer.byteLength - RESPONSE_HEADER_BYTES) / 2)
  const samples = new Int16Array(count)
  for (let index = 0; index < count; index++) samples[index] = view.getInt16(RESPONSE_HEADER_BYTES + index * 2, true)
  return { sampleRateHz, samples }
}

export class PocketAndroidBackend implements TtsBackend {
  readonly id = "pocket" as const
  readonly capabilities = CAPABILITIES
  private language: SpeechLanguage | undefined
  private readonly activeStreams = new Set<number>()

  constructor(
    private readonly invoke: TauriInvoke,
    private readonly now: () => number = Date.now,
  ) {}

  async prepare(config: TtsConfig): Promise<void> {
    try {
      await this.invoke("voice_pocket_prepare", { language: config.language })
    } catch (error) {
      const { code, message } = nativeError(error)
      throw Object.assign(new Error(message), { code })
    }
    this.language = config.language
  }

  async *synthesize(text: string, signal: AbortSignal): AsyncIterable<TtsAudioChunk | TtsProviderError> {
    if (!this.language) {
      yield this.failure(new Error("POCKET_FAILED: synthesize() before prepare()"))
      return
    }
    let stream: number
    try {
      stream = Number(await this.invoke("voice_pocket_stream_start", { text }))
    } catch (error) {
      yield this.failure(error)
      return
    }
    this.activeStreams.add(stream)
    const endStream = () => {
      if (!this.activeStreams.delete(stream)) return
      void this.invoke("voice_pocket_stream_end", { id: stream }).catch(() => undefined)
    }
    signal.addEventListener("abort", endStream, { once: true })
    try {
      for (let sequence = 0; !signal.aborted; sequence++) {
        const chunk = decodePocketChunk(await this.invoke("voice_pocket_stream_read", { id: stream }))
        if (signal.aborted) return
        if (chunk.sampleRateHz === 0) {
          // The engine signals completion with an empty chunk; close the
          // utterance so consumers can flush.
          yield { samples: new Int16Array(0), sampleRateHz: 24_000, generatedAt: this.now(), sequence, final: true }
          return
        }
        yield { samples: chunk.samples, sampleRateHz: chunk.sampleRateHz, generatedAt: this.now(), sequence, final: false }
      }
    } catch (error) {
      yield this.failure(error)
    } finally {
      signal.removeEventListener("abort", endStream)
      endStream()
    }
  }

  async cancel(_requestId: string): Promise<void> {
    for (const stream of [...this.activeStreams]) {
      this.activeStreams.delete(stream)
      await this.invoke("voice_pocket_stream_end", { id: stream }).catch(() => undefined)
    }
  }

  async dispose(): Promise<void> {
    await this.cancel("dispose")
    this.language = undefined
  }

  private failure(error: unknown): TtsProviderError {
    const { code, recoverable, message } = nativeError(error)
    return { code, detail: message, recoverable, capturedAt: this.now() }
  }
}
