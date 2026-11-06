/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { createBrowserSpeechEngine, type RecognitionLike } from "./browser-speech-engine"

class FakeRecognition implements RecognitionLike {
  lang = ""
  continuous = false
  interimResults = false
  onresult: RecognitionLike["onresult"] = null
  onerror: RecognitionLike["onerror"] = null
  onend: RecognitionLike["onend"] = null
  started = 0
  stopped = 0
  aborted = 0

  start(): void {
    this.started += 1
  }

  stop(): void {
    this.stopped += 1
  }

  abort(): void {
    this.aborted += 1
  }

  emit(resultIndex: number, results: { isFinal: boolean; transcript: string }[]): void {
    const shaped = results.map((result) => ({ isFinal: result.isFinal, 0: { transcript: result.transcript } }))
    this.onresult?.({ resultIndex, results: shaped })
  }

  fail(code: string): void {
    this.onerror?.({ error: code })
  }

  end(): void {
    this.onend?.()
  }
}

function setup() {
  const recognition = new FakeRecognition()
  const engine = createBrowserSpeechEngine({
    createRecognition: () => recognition,
    language: () => "fr-FR",
  })
  return { engine, recognition }
}

describe("browser speech engine", () => {
  test("start applies the language and the streaming flags", async () => {
    const { engine, recognition } = setup()
    await engine.start()
    expect(recognition.lang).toBe("fr-FR")
    expect(recognition.continuous).toBe(true)
    expect(recognition.interimResults).toBe(true)
    expect(recognition.started).toBe(1)
  })

  test("interim results are forwarded to the partial listener", async () => {
    const { engine, recognition } = setup()
    const partials: string[] = []
    engine.onPartial!((text) => partials.push(text))
    await engine.start()

    recognition.emit(0, [{ isFinal: false, transcript: "bon" }])
    expect(partials).toEqual(["bon"])
  })

  test("finish resolves with the accumulated final transcript", async () => {
    const { engine, recognition } = setup()
    await engine.start()

    recognition.emit(0, [{ isFinal: true, transcript: "bonjour " }])
    recognition.emit(0, [{ isFinal: true, transcript: "le monde" }])
    const finished = engine.finish()
    expect(recognition.stopped).toBe(1)
    recognition.end()

    expect(await finished).toBe("bonjour le monde")
  })

  test("cancel aborts and yields no transcript", async () => {
    const { engine, recognition } = setup()
    await engine.start()

    await engine.cancel()
    expect(recognition.aborted).toBe(1)
    expect(await engine.finish()).toBe("")
  })

  test("an error while recording triggers an engine stop and rejects the finish", async () => {
    const { engine, recognition } = setup()
    let stops = 0
    engine.onAutoStop!(() => {
      stops += 1
    })
    await engine.start()

    recognition.fail("not-allowed")
    expect(stops).toBe(1)

    await expect(engine.finish()).rejects.toMatchObject({ name: "NotAllowedError" })
  })

  test("a missing recogniser is reported at start", async () => {
    const engine = createBrowserSpeechEngine({
      createRecognition: () => undefined,
      language: () => "en",
    })
    await expect(engine.start()).rejects.toMatchObject({ name: "NotSupportedError" })
  })

  test("partial listeners can be removed", async () => {
    const { engine, recognition } = setup()
    const partials: string[] = []
    const off = engine.onPartial!((text) => partials.push(text))
    await engine.start()

    off()
    recognition.emit(0, [{ isFinal: false, transcript: "x" }])
    expect(partials).toEqual([])
  })
})
