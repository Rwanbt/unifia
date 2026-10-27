/* SPDX-License-Identifier: MIT */

/**
 * PCM helpers shared by every shell that records speech in the browser.
 *
 * The desktop hook used to carry them alone. They are pure except
 * `blobToWavBase64`, which decodes the recorded blob through Web Audio, so the
 * conversion itself is unit-tested on the host.
 */

/** Sample rate the local recognisers expect. */
export const SPEECH_SAMPLE_RATE = 16_000

/** Linear interpolation resampling; adequate for 48 kHz -> 16 kHz capture. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to
  const len = Math.round(samples.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const idx = i * ratio
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, samples.length - 1)
    const frac = idx - lo
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac
  }
  return out
}

/** 16-bit mono PCM WAV with a canonical 44-byte header. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  write(8, "WAVE")
  write(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  write(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buf
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** Decode a recorded blob and return it as base64 WAV at the speech rate. */
export async function blobToWavBase64(blob: Blob, targetRate = SPEECH_SAMPLE_RATE): Promise<string> {
  const audioCtx = new AudioContext({ sampleRate: targetRate })
  try {
    const audioBuffer = await audioCtx.decodeAudioData(await blob.arrayBuffer())
    const samples = audioBuffer.getChannelData(0)
    const resampled = audioBuffer.sampleRate === targetRate
      ? samples
      : resample(samples, audioBuffer.sampleRate, targetRate)
    return arrayBufferToBase64(encodeWav(resampled, targetRate))
  } finally {
    await audioCtx.close()
  }
}
