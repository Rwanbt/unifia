/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { voiceErrorCodeMatchesStage } from "@unifia/contracts/speech"
import { errorFromUnknown } from "./live-controller"
import { NativeVoiceStepError, runNativeVoiceStep, type NativeVoiceStep } from "./native-voice-error"

const STEPS: NativeVoiceStep[] = ["stt-download", "stt-load", "stt-transcribe", "audio-open"]

describe("native Voice step errors", () => {
  test("every step maps to a code that belongs to its stage, never the unclassified one", () => {
    for (const step of STEPS) {
      const { voiceError } = new NativeVoiceStepError(step, new Error("boom"), 1)
      expect(voiceErrorCodeMatchesStage(voiceError.stage, voiceError.code)).toBe(true)
      expect(voiceError.code).not.toBe("UNSUPPORTED_CAPABILITY_UNCLASSIFIED_RUNTIME_ERROR")
      expect(voiceError.timestamp).toBe(1)
    }
  })

  test("a model load failure is a recoverable model-load error", () => {
    const { voiceError } = new NativeVoiceStepError("stt-load", "Load /data/user/0/parakeet/encoder.onnx: bad graph")
    expect(voiceError).toMatchObject({
      stage: "model-load",
      code: "MODEL_LOAD_FAILED",
      legacyCode: "stt_unavailable",
      recoverable: true,
    })
  })

  test("the Rust runtime guard prefix is classified as a non-recoverable ABI error on any step", () => {
    const message = "ABI_UNSUPPORTED: ONNX Runtime 1.23.0 cannot serve C API level 27"
    for (const step of STEPS) {
      const { voiceError } = new NativeVoiceStepError(step, message)
      expect(voiceError).toMatchObject({ stage: "abi", code: "ABI_UNSUPPORTED", recoverable: false })
    }
  })

  test("the user-facing detail never carries the native message", () => {
    const error = new NativeVoiceStepError("stt-load", new Error("Load /data/user/0/ai.unifia.mobile/secret-path"))
    expect(error.message).not.toContain("/data/")
    expect(error.voiceError.detail).not.toContain("/data/")
    expect((error.cause as Error).message).toContain("secret-path")
  })

  test("the Live controller surfaces the classified error instead of a generic internal one", async () => {
    const failure = await runNativeVoiceStep("audio-open", async () => {
      throw new Error("Oboe failed to open capture/playback streams (-9999)")
    }).catch((error: unknown) => error)
    expect(errorFromUnknown(failure)).toMatchObject({ stage: "audio-input", legacyCode: "microphone_unavailable" })
  })

  test("a successful step returns its value untouched", async () => {
    expect(await runNativeVoiceStep("stt-transcribe", async () => "Bonjour")).toBe("Bonjour")
  })
})
