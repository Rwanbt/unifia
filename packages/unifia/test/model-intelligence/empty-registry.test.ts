/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { emptyRegistry, seedEmptyRegistry } from "../../src/model-intelligence/empty-registry"
import { Registry, LiveRegistryLayer, defaultStorage } from "../../src/model-intelligence/registry"
import { MemoryStorage, StorageManager } from "../../src/model-intelligence/storage"

describe("empty registry seed (#92)", () => {
  test("is schema-valid and carries the zeroed health snapshot", () => {
    const registry = emptyRegistry()
    expect(registry.schemaVersion).toBe("1.0.0-draft")
    expect(registry.providers).toEqual([])
    expect(registry.models).toEqual([])
    expect(registry.aliases).toEqual([])
    expect(registry.provenance).toEqual([])
    expect(registry.health.totalProviders).toBe(0)
    expect(registry.health.totalModels).toBe(0)
    expect(registry.registryID).toMatch(/^[a-f0-9]{64}$/)
    expect(registry.generatedAtUTC).toMatch(/Z$/)
  })

  test("is deterministic per generator version", () => {
    expect(emptyRegistry("e2e").registryID).toBe(emptyRegistry("e2e").registryID)
    expect(emptyRegistry("e2e").registryID).not.toBe(emptyRegistry("other").registryID)
  })

  test("loads through a storage manager so the registry reports as loaded", async () => {
    const storage = new MemoryStorage("empty-registry-test")
    await seedEmptyRegistry(storage)
    const manager = new StorageManager(storage)
    await manager.init()
    expect(manager.isLoaded()).toBe(true)
    expect((await manager.get()).models).toEqual([])
  })

  test("the default storage layer serves the seeded registry instead of failing", async () => {
    await seedEmptyRegistry()
    const models = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* Registry
        return yield* registry.listModels()
      }).pipe(Effect.provide(LiveRegistryLayer)),
    )
    expect(models).toEqual([])
    expect(defaultStorage).toBeDefined()
  })
})
