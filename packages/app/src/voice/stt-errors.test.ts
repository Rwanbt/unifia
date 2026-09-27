/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { codeOf, messageOf, raised } from "./stt-errors"
import { STREAMING_STT_ERROR_CODES } from "@unifia/contracts/streaming-stt"

const FALLBACK = "STREAM_FALLBACK_PROGRAMMER_ERROR"

describe("stt-errors (§13 unknown cleanup)", () => {
  describe("messageOf", () => {
    it("returns the message of a real Error", () => {
      expect(messageOf(new Error("boom"))).toBe("boom")
    })
    it("returns the string form of a non-Error", () => {
      expect(messageOf("kaboom")).toBe("kaboom")
      expect(messageOf(42)).toBe("42")
      expect(messageOf(null)).toBe("null")
      expect(messageOf(undefined)).toBe("undefined")
    })
  })

  describe("codeOf — strict, rejects unknown codes", () => {
    it("returns the canonical code from a typed error", () => {
      const err = { code: STREAMING_STT_ERROR_CODES.INFERENCE_TIMEOUT }
      expect(codeOf(err, FALLBACK)).toBe("STREAM_INFERENCE_TIMEOUT")
    })

    it("returns the fallback for the literal `unknown`", () => {
      const err = { code: "unknown" }
      expect(codeOf(err, FALLBACK)).toBe(FALLBACK)
    })

    it("returns the fallback for a non-canonical STREAM_* code", () => {
      const err = { code: "STREAM_SOMETHING_NEW_BUT_UNRECOGNIZED" }
      expect(codeOf(err, FALLBACK)).toBe(FALLBACK)
    })

    it("returns the fallback when the error has no code field", () => {
      expect(codeOf(new Error("plain"), FALLBACK)).toBe(FALLBACK)
      expect(codeOf({}, FALLBACK)).toBe(FALLBACK)
    })

    it("returns the fallback when the code field is not a string", () => {
      expect(codeOf({ code: 42 }, FALLBACK)).toBe(FALLBACK)
      expect(codeOf({ code: null }, FALLBACK)).toBe(FALLBACK)
      expect(codeOf({ code: undefined }, FALLBACK)).toBe(FALLBACK)
    })

    it("returns the fallback for null / undefined / primitives", () => {
      expect(codeOf(null, FALLBACK)).toBe(FALLBACK)
      expect(codeOf(undefined, FALLBACK)).toBe(FALLBACK)
      expect(codeOf("STREAM_INFERENCE_TIMEOUT", FALLBACK)).toBe(FALLBACK)
      expect(codeOf(42, FALLBACK)).toBe(FALLBACK)
    })

    it("accepts an extension set of canonical codes", () => {
      const err = { code: "STREAM_NEW_CODE" }
      expect(codeOf(err, FALLBACK)).toBe(FALLBACK)
      expect(codeOf(err, FALLBACK, ["STREAM_NEW_CODE"])).toBe("STREAM_NEW_CODE")
    })

    it("rejects empty / whitespace / case-mismatched codes", () => {
      expect(codeOf({ code: "" }, FALLBACK)).toBe(FALLBACK)
      expect(codeOf({ code: "STREAM_inference_timeout" }, FALLBACK)).toBe(FALLBACK)
      expect(codeOf({ code: "stream_inference_timeout" }, FALLBACK)).toBe(FALLBACK)
    })

    it("covers every canonical code round-trip", () => {
      for (const code of Object.values(STREAMING_STT_ERROR_CODES)) {
        expect(codeOf({ code }, FALLBACK)).toBe(code)
      }
    })
  })

  describe("raised — refuses non-canonical codes", () => {
    it("carries a canonical code on the thrown error", () => {
      const err = raised(STREAMING_STT_ERROR_CODES.LANGUAGE_UNSUPPORTED, "no es")
      expect(err.code).toBe("STREAM_LANGUAGE_UNSUPPORTED")
      expect(err.message).toBe("no es")
    })

    it("replaces a non-canonical code with STREAM_INVALID_ERROR_CODE", () => {
      const err = raised("STREAM_NOT_REAL", "fake")
      expect(err.code).toBe("STREAM_INVALID_ERROR_CODE")
      expect(err.message).toBe("fake")
    })

    it("replaces the literal `unknown` code with STREAM_INVALID_ERROR_CODE", () => {
      const err = raised("unknown", "no")
      expect(err.code).toBe("STREAM_INVALID_ERROR_CODE")
    })

    it("accepts an extension set for future codes", () => {
      const err = raised("STREAM_FUTURE_CODE", "future", ["STREAM_FUTURE_CODE"])
      expect(err.code).toBe("STREAM_FUTURE_CODE")
    })
  })

  describe("streaming STT error envelope integration", () => {
    it("all canonical codes survive codeOf and produce stable strings", () => {
      const codes = Object.values(STREAMING_STT_ERROR_CODES)
      for (const code of codes) {
        const err = raised(code, `detail-${code}`)
        const recovered = codeOf(err, FALLBACK)
        expect(recovered).toBe(code)
        expect(recovered).not.toBe("unknown")
        expect(recovered).not.toBe(FALLBACK)
      }
    })
  })
})
