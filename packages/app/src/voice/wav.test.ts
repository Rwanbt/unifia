/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { arrayBufferToBase64, encodeWav, resample, SPEECH_SAMPLE_RATE } from "./wav"

function ascii(buf: ArrayBuffer, offset: number, length: number): string {
  return String.fromCharCode(...new Uint8Array(buf.slice(offset, offset + length)))
}

describe("wav helpers", () => {
  test("encodeWav writes a canonical mono 16-bit header", () => {
    const buf = encodeWav(new Float32Array([0, 0.5, -0.5]), SPEECH_SAMPLE_RATE)
    const view = new DataView(buf)

    expect(ascii(buf, 0, 4)).toBe("RIFF")
    expect(ascii(buf, 8, 4)).toBe("WAVE")
    expect(ascii(buf, 12, 4)).toBe("fmt ")
    expect(ascii(buf, 36, 4)).toBe("data")
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(SPEECH_SAMPLE_RATE)
    expect(view.getUint32(28, true)).toBe(SPEECH_SAMPLE_RATE * 2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(Math.trunc(0.5 * 0x7fff))
    expect(view.getInt16(48, true)).toBe(-0.5 * 0x8000)
  })

  test("encodeWav clamps samples outside the normalised range", () => {
    const view = new DataView(encodeWav(new Float32Array([2, -2]), SPEECH_SAMPLE_RATE))
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
  })

  test("resample halves the frame count when the rate halves", () => {
    const out = resample(new Float32Array([0, 1, 0, -1]), 32_000, 16_000)
    expect(out.length).toBe(2)
    expect(Array.from(out)).toEqual([0, 0])
  })

  test("resample leaves the samples untouched when the rates match", () => {
    const input = new Float32Array([0.25, -0.5, 1])
    expect(Array.from(resample(input, 16_000, 16_000))).toEqual([0.25, -0.5, 1])
  })

  test("arrayBufferToBase64 encodes the bytes exactly once", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
    expect(arrayBufferToBase64(bytes.buffer)).toBe(btoa(String.fromCharCode(...bytes)))
  })
})
