/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { TTS_ERROR_CODES, type TtsProviderId } from "@unifia/contracts/tts-router"
import { androidShippedTtsBackends, createAndroidTtsRouter } from "./android-tts-router"
import { createTtsRouter } from "./tts-router"

/** The shipped path must never reach a native call in a unit test. */
const invoke = (command: string): Promise<never> => {
  throw new Error(`unexpected native voice call in a unit test: ${command}`)
}

const KNOWN_PROVIDER_IDS: readonly TtsProviderId[] = ["pocket", "piper", "fallback-android-tts"]

describe("shipped Android TTS providers (VO02 readiness guard)", () => {
  test("the shipped path registers a provider, and every one of them is production-ready", () => {
    const backends = androidShippedTtsBackends(invoke)

    // A shipped path that registers nothing is a defect, not a quiet pass.
    expect(backends.length).toBeGreaterThan(0)

    for (const backend of backends) {
      // `productionReady: false` is the flag that marks a deterministic
      // scaffold or a reference-only provider. The router already skips
      // those; this guard fails the moment one is wired into the shipped
      // path at all, so it can never reach a provider list, a settings
      // screen or a diagnostics payload as if it were ready.
      expect({
        id: backend.id,
        productionReady: backend.capabilities.productionReady,
      }).toEqual({ id: backend.id, productionReady: true })
    }
  })

  test("every shipped provider is a known contract provider id", () => {
    for (const backend of androidShippedTtsBackends(invoke)) {
      expect(KNOWN_PROVIDER_IDS).toContain(backend.id)
    }
  })

  test("no shipped provider can reach a cloud or the network", () => {
    for (const backend of androidShippedTtsBackends(invoke)) {
      expect({ id: backend.id, remoteCapable: backend.capabilities.remoteCapable }).toEqual({
        id: backend.id,
        remoteCapable: false,
      })
      expect(backend.capabilities.cpuOnly).toBe(true)
    }
  })

  test("the shipped router refuses to route rather than substituting a system voice", async () => {
    const router = createAndroidTtsRouter(invoke)

    // A prepared engine lives on the device, so the unit test reaches the
    // MODEL_MISSING path. What matters is the shape of the refusal: the
    // router reports an honest provider error, it never yields PCM from a
    // backend that is not registered here.
    const events: { code: string; recoverable: boolean }[] = []
    for await (const event of router.synthesize(
      { id: "vo02", text: "hello", language: "en", speed: 1 },
      new AbortController().signal,
    )) {
      if ("code" in event) events.push({ code: event.code, recoverable: event.recoverable })
    }

    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect(Object.values(TTS_ERROR_CODES)).toContain(event.code as never)
    }
    expect(events.at(-1)?.recoverable).toBe(false)
  })

  test("a non-production backend stays out of the router even when handed to it", () => {
    // The router is the second line of defence; the guard above is the first.
    // Both are asserted because a scaffold reaching the UI is the exact
    // failure VO02 exists to prevent.
    const scaffold = {
      id: "pocket" as const,
      capabilities: {
        providerId: "pocket" as const,
        languages: ["en"] as const,
        productionReady: false,
        streaming: true,
        voiceCloning: false,
        cpuOnly: true,
        remoteCapable: false,
        ttfaMs: 1,
        chunkCadenceMs: 1,
      },
      prepare: async () => {},
      // eslint-disable-next-line require-yield
      synthesize: async function* () {
        yield { samples: new Int16Array(1), sampleRateHz: 48_000, generatedAt: 0, sequence: 0, final: true }
      },
      cancel: async () => {},
      dispose: async () => {},
    }
    const router = createTtsRouter([scaffold])

    expect(router.prepare("en")).rejects.toThrow(/no production-ready local backend/i)
  })
})
