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
