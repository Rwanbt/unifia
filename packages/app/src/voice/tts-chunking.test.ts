/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { CHUNK_HARD_MAX, mergeShortChunks, splitFirstTinyChunk, splitIntoChunks, splitLongSentence } from "./tts-chunking"

describe("speech chunking", () => {
  test("short text becomes the whole first chunk", () => {
    expect(splitFirstTinyChunk("Salut")).toEqual(["Salut", ""])
  })

  test("the first chunk breaks at the first space after eight characters", () => {
    expect(splitFirstTinyChunk("Bonjour, tout le monde")).toEqual(["Bonjour,", "tout le monde"])
  })

  test("a long single word is cut within the hard limit", () => {
    const word = "a".repeat(150)
    const parts = splitLongSentence(word)
    expect(parts.join("")).toBe(word)
    expect(parts.every((part) => part.length <= CHUNK_HARD_MAX)).toBe(true)
  })

  test("short chunks merge while they fit", () => {
    expect(mergeShortChunks(["a", "b", "c"], 5)).toEqual(["a b c"])
    expect(mergeShortChunks(["aaaa", "bbbb"], 5)).toEqual(["aaaa", "bbbb"])
  })

  test("splitIntoChunks keeps the words, the order and the limit", () => {
    const text = `Bonjour à tous. ${"Cette phrase est volontairement longue pour forcer un découpage. ".repeat(3)}`
    const chunks = splitIntoChunks(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= CHUNK_HARD_MAX)).toBe(true)
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " ").trim())
  })

  test("empty text produces no chunk", () => {
    expect(splitIntoChunks("   ")).toEqual([])
  })
})
