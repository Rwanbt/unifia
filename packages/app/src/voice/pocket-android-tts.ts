/* SPDX-License-Identifier: MIT */
/**
 * Pocket Android TTS adapter — R7 scaffolding (plan §28).
 *
 * Companion to ADR-062 / ADR-074. Implements the canonical `TtsBackend`
 * contract for the Android Pocket runtime. The scaffolding is
 * deterministic (no model weights are actually synthesised in this
 * build — every `synthesize()` call yields a fixed-frame Int16 chunk
 * stream whose cadence and final-flag mirror what the real
 * `PocketTTS.cpp` binding will produce once the .so is loaded on
 * device).
 *
 * Goal of this scaffold:
 *   1. Provide a complete `TtsBackend` so the canonical `TtsRouter`
 *      (R8, packages/contracts/src/tts-router.ts) can resolve `pocket`
 *      as the primary entry of `TTS_DEFAULT_FALLBACK_ORDER` on Android.
 *   2. Lock the 5-language coverage (EN/FR/ES/IT/DE) and the contract
 *      surface so the real `PocketTTS.cpp` JNI binding slots in as
 *      a one-line `prepare` / `synthesize` swap on a future R7.x
 *      commit once device benches satisfy the gate.
 *   3. Carry the Rust+TS dual-runtime parity: the same contract is
 *      already consumed by the desktop Python `TtsRouter` in
 *      `packages/voice-host/voice_host/live/tts.py` (per ADR-058 baseline).
 *
 * NOT in this scaffolding:
 *   * actual neural synthesis — call the device .so once the
 *     PocketTTS.cpp build + Rust ABI integration land (R7 hardware gate).
 *   * voice cloning — present in `capabilities` only (matches the
 *     desktop Pocket runtime which supports voice cloning).
 *
 * Cancellation note: `synthesize()` yields at most one chunk per
 * ms and checks `signal.aborted` before every yield, matching the
 * async-generator lesson recorded in the R8 contract.
 */

import {
  TTS_ERROR_CODES,
  type TtsAudioChunk,
  type TtsBackend,
  type TtsCapabilities,
  type TtsConfig,
  type TtsProviderError,
  type TtsProviderId,
} from "@unifia/contracts/tts-router"
import type { SpeechLanguage } from "@unifia/contracts/speech"

/** Languages the PocketAndroid runtime advertises. */
const POCKET_LANGUAGES: readonly SpeechLanguage[] = [
  "en",
  "fr",
  "es",
  "it",
  "de",
] as const

/** Internal cadence for the scaffolding chunk stream. */
const SAMPLE_RATE_HZ = 22_050
const CHUNK_FRAME_COUNT = 480 // ~21.8 ms @ 22050 Hz, matches candidate KT-1 cadence
const CHUNKS_PER_CHAR = 0.4 // deterministic length scaling for tests
const MIN_CHUNKS = 4
const MAX_CHUNKS = 96
const TTFA_MS = 180 // matches Kyutai Pocket CPU baseline
const CHUNK_CADENCE_MS = 22

export interface PocketAndroidBackendOptions {
  /**
   * Override the sample-rate emitted by the scaffold. Defaults to the
   * canonical Kyutai Pocket output rate (22050 Hz). Tests can pin
   * a fixed value to make golden assertions stable.
   */
  readonly sampleRateHz?: number
  /**
   * Inject a deterministic clock source for chunk timestamps. Defaults
   * to `() => 0` (the scaffolding does not own a clock). Production
   * integration will pass a monotonic clock that feeds from the
   * Android AudioClock.
   */
  readonly clock?: () => number
}

/**
 * Deterministic scaffold that occupies the contract slot the future
 * `PocketTTS.cpp` JNI binding will own on device. Methods reject
 * unsupported languages per ADR-062 + plan §29, and `synthesize()`
 * always yields chunks with `final: true` exactly once at the end
 * so downstream renderers can flush their buffer cleanly.
 */
export class PocketAndroidBackend implements TtsBackend {
  public readonly id: TtsProviderId = "pocket"
  public readonly capabilities: TtsCapabilities

  private readonly _sampleRateHz: number
  private readonly _clock: () => number
  private _preparedLanguage: SpeechLanguage | null = null
  private _cancelled = false

  constructor(options: PocketAndroidBackendOptions = {}) {
    this._sampleRateHz = options.sampleRateHz ?? SAMPLE_RATE_HZ
    this._clock = options.clock ?? (() => 0)
    this.capabilities = {
      providerId: "pocket",
      languages: POCKET_LANGUAGES,
      streaming: true,
      voiceCloning: true,
      cpuOnly: true,
      remoteCapable: false,
      ttfaMs: TTFA_MS,
      chunkCadenceMs: CHUNK_CADENCE_MS,
    }
  }

  /**
   * Validate the requested configuration against the Pocket runtime
   * capability matrix. Throws TtsProviderError-shaped exceptions for
   * unsupported languages / shapes — the canonical TtsRouter catches
   * them and walks the fallback chain.
   */
  async prepare(config: TtsConfig, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw providerError(
        TTS_ERROR_CODES.STREAMING_CANCELLED,
        "aborted before prepare",
        false,
      )
    }
    if (!POCKET_LANGUAGES.includes(config.language)) {
      throw providerError(
        TTS_ERROR_CODES.LANGUAGE_UNSUPPORTED,
        `Pocket Android does not cover language '${String(config.language)}'`,
        false,
      )
    }
    if (!Number.isFinite(config.speed) || config.speed <= 0) {
      throw providerError(
        TTS_ERROR_CODES.MODEL_LOAD_FAILED,
        `invalid speed ${String(config.speed)}`,
        false,
      )
    }
    this._preparedLanguage = config.language
    this._cancelled = false
  }

  /**
   * Yield a deterministic Int16 PCM chunk stream. The real binding
   * will replace the body of this method with native JNI calls into
   * the loaded Pocket model; the surrounding structure (signal
   * observation, chunk numbering, final flag) stays identical so
   * the contract surface is stable across the swap.
   */
  async *synthesize(
    text: string,
    signal: AbortSignal,
  ): AsyncIterable<TtsAudioChunk | TtsProviderError> {
    if (this._preparedLanguage === null) {
      yield providerError(
        TTS_ERROR_CODES.MODEL_LOAD_FAILED,
        "synthesize() called before prepare()",
        false,
      )
      return
    }
    if (this._cancelled) {
      yield providerError(
        TTS_ERROR_CODES.STREAMING_CANCELLED,
        "synthesize() called after cancel()",
        false,
      )
      return
    }
    const totalChunks = clamp(
      Math.max(MIN_CHUNKS, Math.ceil(text.length * CHUNKS_PER_CHAR)),
      MIN_CHUNKS,
      MAX_CHUNKS,
    )
    for (let i = 0; i < totalChunks; i++) {
      if (signal.aborted || this._cancelled) return
      yield {
        samples: makeScaffoldSamples(CHUNK_FRAME_COUNT, i),
        sampleRateHz: this._sampleRateHz,
        generatedAt: this._clock() + i * CHUNK_CADENCE_MS,
        sequence: i,
        final: i === totalChunks - 1,
      }
    }
  }

  async cancel(_requestId: string): Promise<void> {
    this._cancelled = true
  }

  async dispose(): Promise<void> {
    this._cancelled = false
    this._preparedLanguage = null
  }
}

function providerError(
  code: string,
  detail: string,
  recoverable: boolean,
  capturedAt = 0,
): Error & TtsProviderError {
  // TtsProviderError's fields are declared `readonly`; attach the
  // metadata via `Object.assign` (same pattern as
  // `tts-router-mock.ts#provider-error`) so the contract surface is
  // preserved without TypeScript complaining about widening.
  return Object.assign(new Error(detail), {
    code,
    recoverable,
    capturedAt,
  }) as Error & TtsProviderError
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low
  if (value > high) return high
  return value
}

/**
 * The scaffold chunk payload. Produces an Int16 buffer filled with a
 * 1000-Hz-style carrier derived from the chunk sequence — deterministic,
 * no audio output device is plugged in, this is purely a structural
 * placeholder the real runtime will replace.
 */
function makeScaffoldSamples(frameCount: number, sequence: number): Int16Array {
  const out = new Int16Array(frameCount)
  // Tiny inaudible-amplitude pulse — chosen so the chunk is non-empty
  // (validators can check sample buffer length) but does not produce
  // an audible tone that tests would need to suppress.
  for (let i = 0; i < frameCount; i++) {
    out[i] = (((i + sequence * 7) % 8) - 4) as unknown as number
  }
  return out
}

export const __test_only__ = {
  makeScaffoldSamples,
  clamp,
  SAMPLE_RATE_HZ,
  CHUNK_FRAME_COUNT,
  POCKET_LANGUAGES,
}
