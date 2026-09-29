/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { TtsAudioChunk } from "@unifia/contracts/tts-router"
import { createWebAudioPcmPlayer } from "./webaudio-pcm-player"

type FakeSource = {
  buffer: { duration: number; data: Float32Array } | null
  onended: (() => void) | null
  startedAt?: number
  stopped: boolean
  connect(): void
  start(at: number): void
  stop(): void
}

function fakeContext() {
  const sources: FakeSource[] = []
  const calls: string[] = []
  const context = {
    currentTime: 1,
    state: "running",
    destination: {},
    createBuffer(_channels: number, length: number, rate: number) {
      const data = new Float32Array(length)
      return { duration: length / rate, getChannelData: () => data, data }
    },
    createBufferSource() {
      const source: FakeSource = {
        buffer: null,
        onended: null,
        stopped: false,
        connect() {},
        start(at) { this.startedAt = at },
        stop() { this.stopped = true },
      }
      sources.push(source)
      return source
    },
    async suspend() { calls.push("suspend") },
    async resume() { calls.push("resume") },
    async close() { calls.push("close") },
  }
  return { context: context as unknown as AudioContext, sources, calls }
}

const chunk = (samples: number[], sampleRateHz = 10): TtsAudioChunk => ({
  samples: Int16Array.from(samples),
  sampleRateHz,
  generatedAt: 0,
  sequence: 0,
  final: false,
})

describe("WebAudio PCM player", () => {
  test("schedules chunks back to back and converts PCM16 to float", () => {
    const { context, sources } = fakeContext()
    const player = createWebAudioPcmPlayer(context)

    player.enqueue(chunk([16384, -32768], 10))
    player.enqueue(chunk([0, 0, 0, 0], 10))

    expect(sources.map((source) => source.startedAt)).toEqual([1, 1.2])
    expect(Array.from(sources[0]!.buffer!.data)).toEqual([0.5, -1])
  })

  test("drain resolves only after the last scheduled chunk ends", async () => {
    const { context, sources } = fakeContext()
    const player = createWebAudioPcmPlayer(context)
    player.enqueue(chunk([1]))
    player.enqueue(chunk([1]))
    let drained = false
    const done = player.drain().then(() => { drained = true })

    sources[0]!.onended?.()
    await Promise.resolve()
    expect(drained).toBe(false)
    sources[1]!.onended?.()
    await done
    expect(drained).toBe(true)
  })

  test("pause and resume suspend the context; stop silences, settles drain and closes", async () => {
    const { context, sources, calls } = fakeContext()
    const player = createWebAudioPcmPlayer(context)
    player.enqueue(chunk([1]))

    await player.pause()
    expect(player.paused).toBe(true)
    await player.resume()
    player.stop()
    await player.drain()
    player.enqueue(chunk([1]))

    expect(calls).toEqual(["suspend", "resume", "close"])
    expect(sources[0]!.stopped).toBe(true)
    expect(sources).toHaveLength(1)
  })
})
