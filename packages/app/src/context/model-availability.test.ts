import { describe, expect, test } from "bun:test"
import { isUnavailableFreeModel } from "./model-availability"

describe("isUnavailableFreeModel", () => {
  test("hides free opencode models", () => {
    expect(isUnavailableFreeModel("opencode", undefined)).toBe(true)
    expect(isUnavailableFreeModel("opencode", { input: 0 })).toBe(true)
  })

  test("keeps paid opencode models and other providers", () => {
    expect(isUnavailableFreeModel("opencode", { input: 1 })).toBe(false)
    expect(isUnavailableFreeModel("local-llm", undefined)).toBe(false)
    expect(isUnavailableFreeModel("openrouter", { input: 0 })).toBe(false)
  })
})
