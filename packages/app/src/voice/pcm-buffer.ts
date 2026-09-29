/* SPDX-License-Identifier: MIT */
/**
 * Bounded PCM16 accumulator and WAV encoder shared by the streaming
 * STT providers.
 *
 * WHY a bound: Live turns are capped at 60 s by the capture segmenter,
 * but a provider must never grow an audio buffer without a limit — a
 * stuck consumer or a runaway frame source would otherwise exhaust
 * memory on mobile. The buffer drops the oldest whole chunks past the
 * cap and reports the drop so callers stay honest about what the final
 * STT actually saw.
 */

/** Maximum retained audio for one turn, in seconds. Mirrors the
 *  CaptureSegmenter maximum-duration policy (campaign §19). */
export const PCM_TURN_SECONDS = 60

export interface PcmBuffer {
  /** Total samples appended, including samples later dropped. */
  readonly pushed: number
  /** Samples currently retained. */
  readonly kept: number
  /** Samples dropped because the buffer exceeded its cap. */
  readonly dropped: number
  push(samples: Int16Array): void
  concat(): Int16Array
}

export function createPcmBuffer(maxSamples: number): PcmBuffer {
  if (!Number.isFinite(maxSamples) || maxSamples <= 0) {
    throw new Error("PcmBuffer requires a positive sample cap")
  }
  const chunks: Int16Array[] = []
  let kept = 0
  let pushed = 0
  const drop = (count: number) => {
    let left = count
    while (left > 0 && chunks.length > 0) {
      const first = chunks[0]
      if (!first) break
      if (first.length <= left) {
        chunks.shift()
        kept -= first.length
        left -= first.length
        continue
      }
      chunks[0] = first.subarray(first.length - (first.length - left))
      kept -= left
      left = 0
    }
  }
  return {
    get pushed() {
      return pushed
    },
    get kept() {
      return kept
    },
    get dropped() {
      return pushed - kept
    },
    push(samples: Int16Array) {
      pushed += samples.length
      if (samples.length === 0) return
      chunks.push(samples)
      kept += samples.length
      if (kept > maxSamples) drop(kept - maxSamples)
    },
    concat() {
      if (chunks.length === 1) {
        const only = chunks[0]
        if (only) return only.slice()
      }
      const out = new Int16Array(kept)
      let at = 0
      for (const chunk of chunks) {
        out.set(chunk, at)
        at += chunk.length
      }
      return out
    },
  }
}

/** Encode mono PCM16 samples as a canonical 44-byte-header RIFF/WAVE
 *  buffer — the upload shape nemo-speech's offline transcription
 *  endpoint accepts for the empty-final route-around. The return type
 *  is inferred (Uint8Array<ArrayBuffer>) so it stays a valid BlobPart. */
export function pcmToWav(samples: Int16Array, sampleRateHz: number) {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new Error("pcmToWav requires a positive sample rate")
  }
  const dataBytes = samples.length * 2
  const out = new Uint8Array(44 + dataBytes)
  const view = new DataView(out.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRateHz, true)
  view.setUint32(28, sampleRateHz * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, dataBytes, true)
  out.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 44)
  return out
}
