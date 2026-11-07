/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  findInstalledModelFile,
  pruneToInstalled,
  runnableModelFiles,
  servesManagedRuntime,
} from "../../src/local-llm-server/installed-models"

describe("servesManagedRuntime", () => {
  test("no baseURL means the managed llama-server", () => {
    expect(servesManagedRuntime(undefined, 14097)).toBe(true)
  })

  test("a loopback URL on the managed port is the managed runtime", () => {
    expect(servesManagedRuntime("http://127.0.0.1:14097/v1", 14097)).toBe(true)
    expect(servesManagedRuntime("http://localhost:14097/v1", 14097)).toBe(true)
  })

  test("another server keeps its own models", () => {
    expect(servesManagedRuntime("http://localhost:11434/v1", 14097)).toBe(false)
    expect(servesManagedRuntime("http://192.168.1.5:14097/v1", 14097)).toBe(false)
    expect(servesManagedRuntime("not a url", 14097)).toBe(false)
  })
})

describe("findInstalledModelFile", () => {
  const files = ["gemma-4-E4B-it-Q4_K_M.gguf", "Ornith-1.5-9B.gguf", "notes.txt"]

  test("matches an exact file name, with or without the extension", () => {
    expect(findInstalledModelFile("Ornith-1.5-9B", files)).toBe("Ornith-1.5-9B.gguf")
    expect(findInstalledModelFile("ornith-1.5-9b.gguf", files)).toBe("Ornith-1.5-9B.gguf")
  })

  test("matches a model id against a quantized file name", () => {
    expect(findInstalledModelFile("gemma-4-E4B-it", files)).toBe("gemma-4-E4B-it-Q4_K_M.gguf")
  })

  test("ignores partial downloads and other files", () => {
    expect(findInstalledModelFile("LFM3-1.7B", ["LFM3-1.7B-Q6_K.gguf.part", "LFM3-1.7B.txt"])).toBeUndefined()
  })
})

describe("runnableModelFiles", () => {
  test("keeps gguf models and drops vision projectors and partial files", () => {
    expect(runnableModelFiles(["a.gguf", "mmproj-a.gguf", "b.gguf.part", "B.GGUF"])).toEqual(["a.gguf", "B.GGUF"])
  })
})

describe("pruneToInstalled", () => {
  test("drops configured models whose file is gone", () => {
    const configured = { "gemma-4-E4B-it": { ctx: 1 }, "Ornith-1.5-9B": { ctx: 2 }, deleted: { ctx: 3 } }
    expect(pruneToInstalled(configured, ["gemma-4-E4B-it-Q4_K_M.gguf", "Ornith-1.5-9B.gguf"])).toEqual({
      "gemma-4-E4B-it": { ctx: 1 },
      "Ornith-1.5-9B": { ctx: 2 },
    })
  })

  test("an empty models directory leaves no model", () => {
    expect(pruneToInstalled({ gone: {} }, [])).toEqual({})
  })

  test("a projector alone does not keep a model", () => {
    expect(pruneToInstalled({ "mmproj-gemma": {} }, ["mmproj-gemma.gguf"])).toEqual({})
  })
})
