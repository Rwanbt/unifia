/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { SpeechSegmenter, type SpeechSegment } from "./speech-segmenter"
import { phrase, redactSecrets, render } from "./speech-renderer"

/** Cross-runtime parity: the same fixture is asserted against the Python
 * reference in `packages/voice-host/tests/test_text_parity.py`. Both sides
 * must reproduce `packages/voice-core/fixtures/speech-text-parity.json`
 * byte-for-byte; regenerate it only from the Python reference via
 * `scripts/voice/generate-speech-fixtures.py`. */
interface SegmenterCase {
  name: string
  steps: Array<{ delta: string; segments: SpeechSegment[] }>
  flush: SpeechSegment[]
}

interface TextCase {
  name: string
  language: string
  input: string
  output: string | null
}

/** `redactSecrets` never returns null (it only replaces in place). */
interface RedactCase {
  name: string
  language: string
  input: string
  output: string
}

interface PhraseCase {
  language: string
  key: Parameters<typeof phrase>[1]
  values: Record<string, string | number>
  output: string
}

const fixture = (await Bun.file(new URL("../../../voice-core/fixtures/speech-text-parity.json", import.meta.url)).json()) as {
  version: number
  segmenter: SegmenterCase[]
  render: TextCase[]
  redact: RedactCase[]
  phrases: PhraseCase[]
}

describe("speech text parity (Python reference fixture)", () => {
  test("fixture is present and versioned", () => {
    expect(fixture.version).toBe(1)
    expect(fixture.segmenter.length).toBeGreaterThan(10)
    expect(fixture.render.length).toBeGreaterThan(10)
    expect(fixture.redact.length).toBeGreaterThan(5)
    expect(fixture.phrases.length).toBe(45)
  })

  test("SpeechSegmenter reproduces every incremental step and flush", () => {
    for (const entry of fixture.segmenter) {
      const segmenter = new SpeechSegmenter()
      const steps = entry.steps.map((step) => ({ delta: step.delta, segments: segmenter.push(step.delta) }))
      const flush = segmenter.flush()
      expect({ name: entry.name, steps, flush }).toEqual({ name: entry.name, steps: entry.steps, flush: entry.flush })
    }
  })

  test("render reproduces the reference output", () => {
    for (const entry of fixture.render) {
      expect({ name: entry.name, output: render(entry.input, entry.language) }).toEqual({
        name: entry.name,
        output: entry.output,
      })
    }
  })

  test("redactSecrets reproduces the reference output", () => {
    for (const entry of fixture.redact) {
      expect({ name: entry.name, output: redactSecrets(entry.input, entry.language) }).toEqual({
        name: entry.name,
        output: entry.output,
      })
    }
  })

  test("phrases reproduce the reference output for all five languages", () => {
    for (const entry of fixture.phrases) {
      expect({ language: entry.language, key: entry.key, output: phrase(entry.language, entry.key, entry.values) }).toEqual({
        language: entry.language,
        key: entry.key,
        output: entry.output,
      })
    }
  })
})
