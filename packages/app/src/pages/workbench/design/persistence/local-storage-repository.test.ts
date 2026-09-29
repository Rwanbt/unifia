/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { doc, rect } from "../model/fixtures"
import {
  createLocalStorageDesignDocumentRepository,
  designDocumentStoragePrefix,
  type DesignDocumentStorage,
} from "./local-storage-repository"

function memoryStorage(): DesignDocumentStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
  }
}

describe("local storage design document repository", () => {
  test("save and load round-trip a canonical document", async () => {
    const storage = memoryStorage()
    const repository = createLocalStorageDesignDocumentRepository(storage)
    const document = doc([rect("a")])
    await repository.save(document)
    expect(await repository.load("doc")).toEqual(document)
    expect(storage.entries.has(`${designDocumentStoragePrefix}doc`)).toBe(true)
  })

  test("a missing document resolves to undefined", async () => {
    const repository = createLocalStorageDesignDocumentRepository(memoryStorage())
    expect(await repository.load("doc")).toBeUndefined()
  })

  test("a corrupt entry is dropped so the document can recover", async () => {
    const storage = memoryStorage()
    const repository = createLocalStorageDesignDocumentRepository(storage)
    storage.setItem(`${designDocumentStoragePrefix}doc`, "{not json")
    expect(await repository.load("doc")).toBeUndefined()
    expect(storage.entries.has(`${designDocumentStoragePrefix}doc`)).toBe(false)
  })

  test("an invalid document is dropped too", async () => {
    const storage = memoryStorage()
    const repository = createLocalStorageDesignDocumentRepository(storage)
    storage.setItem(`${designDocumentStoragePrefix}doc`, JSON.stringify({ schemaVersion: 1 }))
    expect(await repository.load("doc")).toBeUndefined()
    expect(storage.entries.has(`${designDocumentStoragePrefix}doc`)).toBe(false)
  })

  test("a newer schema version keeps its bytes untouched", async () => {
    const storage = memoryStorage()
    const repository = createLocalStorageDesignDocumentRepository(storage)
    const future = JSON.stringify({ schemaVersion: 99, nodes: {} })
    storage.setItem(`${designDocumentStoragePrefix}doc`, future)
    expect(await repository.load("doc")).toBeUndefined()
    expect(storage.entries.get(`${designDocumentStoragePrefix}doc`)).toBe(future)
  })

  test("remove clears the stored document", async () => {
    const storage = memoryStorage()
    const repository = createLocalStorageDesignDocumentRepository(storage)
    await repository.save(doc([rect("a")]))
    await repository.remove("doc")
    expect(await repository.load("doc")).toBeUndefined()
  })
})
