/* SPDX-License-Identifier: MIT */
/**
 * The validated local fallback of the canonical TTS chain on Android
 * (ADR-062: Pocket, then a validated local fallback, then an explicit error).
 *
 * The native side (`voice_tts_system_synthesize`, Kotlin
 * `SystemSpeechSynthesizer`) renders text with an installed, network-free
 * system voice and returns PCM, so the audio goes through the router and the
 * shared playback arbitration like any other backend. The Android WebView
 * exposes no voices to `speechSynthesis`, which is why this is native.
 *
 * It is reported as `fallback-android-tts`, never as Pocket.
 */

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

/** Text per native call: small enough for a fast first sentence, large enough
 *  to avoid audible gaps between calls. */
const MAX_PIECE_CHARS = 280
const RESPONSE_HEADER_BYTES = 4

const NATIVE_ERROR_CODES: ReadonlyArray<readonly [prefix: string, code: string]> = [
  ["SYSTEM_TTS_LANGUAGE_UNAVAILABLE", TTS_ERROR_CODES.LANGUAGE_UNSUPPORTED],
  ["SYSTEM_TTS_UNAVAILABLE", TTS_ERROR_CODES.PROVIDER_OFFLINE],
  ["SYSTEM_TTS_FAILED", TTS_ERROR_CODES.MODEL_LOAD_FAILED],
]

const CAPABILITIES: TtsCapabilities = {
  providerId: "fallback-android-tts",
  languages: TTS_LANGUAGES,
  productionReady: true,
  streaming: false,
  voiceCloning: false,
  cpuOnly: true,
  remoteCapable: false,
  ttfaMs: 600,
  chunkCadenceMs: 0,
}

/** Splits text on sentence ends into pieces of at most MAX_PIECE_CHARS. */
export function splitSpeechPieces(text: string, maxChars = MAX_PIECE_CHARS): string[] {
  const sentences = text.match(/[^.!?…\n]+[.!?…]*[\s\n]*/g) ?? []
  const pieces: string[] = []
  let current = ""
  for (const sentence of sentences) {
    for (let start = 0; start < sentence.length; start += maxChars) {
      const part = sentence.slice(start, start + maxChars)
      if (current && current.length + part.length > maxChars) {
        pieces.push(current.trim())
        current = ""
      }
      current += part
    }
  }
  if (current.trim()) pieces.push(current.trim())
  return pieces.filter(Boolean)
}

/** Decodes `u32 LE sample rate || PCM16 LE mono` from the native command. */
export function decodeSystemTtsResponse(response: unknown): { sampleRateHz: number; samples: Int16Array } {
  const buffer = response instanceof ArrayBuffer
    ? response
    : ArrayBuffer.isView(response)
      ? response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength)
      : Array.isArray(response)
        ? new Uint8Array(response as number[]).buffer
        : undefined
  if (!buffer || buffer.byteLength < RESPONSE_HEADER_BYTES) throw new Error("SYSTEM_TTS_FAILED: malformed native response")
  const view = new DataView(buffer)
  const sampleRateHz = view.getUint32(0, true)
  const count = Math.floor((buffer.byteLength - RESPONSE_HEADER_BYTES) / 2)
  const samples = new Int16Array(count)
  for (let index = 0; index < count; index++) samples[index] = view.getInt16(RESPONSE_HEADER_BYTES + index * 2, true)
  return { sampleRateHz, samples }
}

function classify(error: unknown, now: number): TtsProviderError {
  const message = error instanceof Error ? error.message : String(error)
  const code = NATIVE_ERROR_CODES.find(([prefix]) => message.startsWith(prefix))?.[1] ?? TTS_ERROR_CODES.MODEL_LOAD_FAILED
  return { code, detail: message, recoverable: code !== TTS_ERROR_CODES.LANGUAGE_UNSUPPORTED, capturedAt: now }
}

export class AndroidSystemTtsBackend implements TtsBackend {
  readonly id = "fallback-android-tts" as const
  readonly capabilities = CAPABILITIES
  private config: TtsConfig | undefined

  constructor(
    private readonly invoke: TauriInvoke,
    private readonly now: () => number = Date.now,
  ) {}

  async prepare(config: TtsConfig): Promise<void> {
    if (!TTS_LANGUAGES.includes(config.language)) {
      throw Object.assign(new Error(`no system voice route for '${config.language}'`), {
        code: TTS_ERROR_CODES.LANGUAGE_UNSUPPORTED,
      })
    }
    this.config = config
  }

  async *synthesize(text: string, signal: AbortSignal): AsyncIterable<TtsAudioChunk | TtsProviderError> {
    const config = this.config
    if (!config) {
      yield classify(new Error("SYSTEM_TTS_FAILED: synthesize() before prepare()"), this.now())
      return
    }
    const pieces = splitSpeechPieces(text)
    for (let sequence = 0; sequence < pieces.length; sequence++) {
      if (signal.aborted) return
      let decoded: { sampleRateHz: number; samples: Int16Array }
      try {
        decoded = decodeSystemTtsResponse(
          await this.invoke("voice_tts_system_synthesize", {
            text: pieces[sequence],
            language: config.language,
            rate: config.speed,
          }),
        )
      } catch (error) {
        yield classify(error, this.now())
        return
      }
      if (signal.aborted) return
      yield {
        samples: decoded.samples,
        sampleRateHz: decoded.sampleRateHz,
        generatedAt: this.now(),
        sequence,
        final: sequence === pieces.length - 1,
      }
    }
  }

  // The native call renders a whole piece at once; aborting the signal stops
  // before the next piece, which is the finest cancellation it offers.
  async cancel(_requestId: string): Promise<void> {}

  async dispose(): Promise<void> {
    this.config = undefined
  }
}
