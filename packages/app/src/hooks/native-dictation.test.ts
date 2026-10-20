/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createNativeDictation, nativeDictationForRuntime } from "./native-dictation"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("createNativeDictation", () => {
  test("starts the native recording and pumps capture until finish", async () => {
    const calls: string[] = []
    const invoke = async (command: string) => {
      calls.push(command)
      return command === "voice_audio_dictation_finish" ? "bonjour" : undefined
    }
    const dictation = createNativeDictation(invoke, 1)

    await dictation.start()
    await wait(12)
    expect(calls[0]).toBe("voice_audio_dictation_start")
    expect(calls.filter((command) => command === "voice_audio_poll").length).toBeGreaterThan(0)

    const text = await dictation.finish()
    expect(text).toBe("bonjour")
    const pumpedBeforeFinish = calls.filter((command) => command === "voice_audio_poll").length
    await wait(12)
    expect(calls.filter((command) => command === "voice_audio_poll").length).toBe(pumpedBeforeFinish)
  })

  test("returns an empty transcript when the native side returns something else", async () => {
    const dictation = createNativeDictation(async () => null, 1)
    await dictation.start()
    expect(await dictation.finish()).toBe("")
  })

  test("does not start pumping when the native start fails", async () => {
    const calls: string[] = []
    const dictation = createNativeDictation(async (command) => {
      calls.push(command)
      throw new Error("Android audio is busy")
    }, 1)
    await expect(dictation.start()).rejects.toThrow("Android audio is busy")
    await wait(12)
    expect(calls).toEqual(["voice_audio_dictation_start"])
  })

  test("a failed capture poll is reported by finish, after the native session is closed", async () => {
    const calls: string[] = []
    const invoke = async (command: string) => {
      calls.push(command)
      if (command === "voice_audio_poll") throw new Error("Oboe audio stream failed (3)")
      return undefined
    }
    const dictation = createNativeDictation(invoke, 1)
    await dictation.start()
    await wait(12)
    await expect(dictation.finish()).rejects.toThrow("Oboe audio stream failed (3)")
    expect(calls).toContain("voice_audio_dictation_finish")
  })

  test("never has two capture polls in flight at once", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const invoke = async (command: string) => {
      if (command !== "voice_audio_poll") return undefined
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await wait(5)
      inFlight--
      return undefined
    }
    const dictation = createNativeDictation(invoke, 1)
    await dictation.start()
    await wait(30)
    await dictation.finish()
    expect(maxInFlight).toBe(1)
  })
})

describe("nativeDictationForRuntime", () => {
  test("is undefined outside the mobile shell", () => {
    const scope = { __TAURI__: { core: { invoke: async () => undefined } } }
    expect(nativeDictationForRuntime(false, scope)).toBeUndefined()
  })

  test("is undefined when the Tauri bridge is missing", () => {
    expect(nativeDictationForRuntime(true, {})).toBeUndefined()
  })

  test("routes through the Tauri bridge on mobile", async () => {
    const seen: string[] = []
    const scope = {
      __TAURI__: {
        core: {
          invoke: async (command: string) => {
            seen.push(command)
            return command === "voice_audio_dictation_finish" ? "salut" : undefined
          },
        },
      },
    }
    const dictation = nativeDictationForRuntime(true, scope)
    expect(dictation).toBeDefined()
    await dictation!.start()
    expect(await dictation!.finish()).toBe("salut")
    expect(seen).toContain("voice_audio_dictation_start")
    expect(seen).toContain("voice_audio_dictation_finish")
  })
})

describe("createNativeDictation one-minute cap", () => {
  test("notifies the cap listener exactly once when the native poll reports it", async () => {
    const invoke = async (command: string) => (command === "voice_audio_poll" ? { dictation_full: true } : "")
    const dictation = createNativeDictation(invoke as never, 1)
    let fired = 0
    dictation.onFull(() => {
      fired++
    })
    await dictation.start()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await dictation.finish()
    expect(fired).toBe(1)
  })

  test("never notifies while the native poll reports the cap is not reached", async () => {
    const invoke = async (command: string) => (command === "voice_audio_poll" ? { dictation_full: false } : "")
    const dictation = createNativeDictation(invoke as never, 1)
    let fired = 0
    dictation.onFull(() => {
      fired++
    })
    await dictation.start()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await dictation.finish()
    expect(fired).toBe(0)
  })
})
test("a due preview is decoded once and reaches the partial listener", async () => {
  const invoke = async (command: string) => (command === "voice_audio_poll" ? { preview_due: true } : "bonjour")
  const dictation = createNativeDictation(invoke as never, 1)
  const seen: string[] = []
  dictation.onPartial((text) => seen.push(text))
  await dictation.start()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await dictation.finish()
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.every((text) => text === "bonjour")).toBe(true)
})
test("a reported level and auto-stop reach their listeners", async () => {
  const invoke = async (command: string) => (command === "voice_audio_poll" ? { level: 0.42, auto_stop: true } : "")
  const dictation = createNativeDictation(invoke as never, 1)
  const levels: number[] = []
  let stops = 0
  dictation.onLevel((level) => levels.push(level))
  dictation.onAutoStop(() => stops++)
  await dictation.start()
  await new Promise((resolve) => setTimeout(resolve, 25))
  await dictation.finish()
  expect(levels).toContain(0.42)
  expect(stops).toBeGreaterThan(0)
})