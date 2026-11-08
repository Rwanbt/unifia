import { describe, expect, test } from "bun:test"
import { compareModelGroups, compareProviders, hasLocalModels, localModelID } from "./model-picker-order"

describe("compareProviders", () => {
  test("puts local AI before every other provider", () => {
    const sorted = ["openrouter", "zai", "anthropic", "local-llm", "opencode"].sort(compareProviders)
    expect(sorted[0]).toBe("local-llm")
    expect(sorted.slice(1, 4)).toEqual(["opencode", "anthropic", "openrouter"])
    expect(sorted[4]).toBe("zai")
  })
})

describe("compareModelGroups", () => {
  test("keeps favorites on top and local AI as the first provider group", () => {
    const groups = [
      { category: "Anthropic", providerID: "anthropic" },
      { category: "Local AI", providerID: "local-llm" },
      { category: "Favorites", providerID: "openai" },
    ].sort(compareModelGroups)
    expect(groups.map((g) => g.providerID)).toEqual(["openai", "local-llm", "anthropic"])
  })
})

describe("hasLocalModels", () => {
  test("is false before any model is downloaded", () => {
    expect(hasLocalModels([])).toBe(false)
    expect(hasLocalModels([{ provider: { id: "anthropic" } }])).toBe(false)
  })

  test("is true once a local model is registered", () => {
    expect(hasLocalModels([{ provider: { id: "local-llm" } }])).toBe(true)
  })
})

describe("localModelID", () => {
  test("strips the extension and quantization suffix", () => {
    expect(localModelID("gemma-4-E4B-it-Q4_K_M.gguf")).toBe("gemma-4-E4B-it")
  })
})
