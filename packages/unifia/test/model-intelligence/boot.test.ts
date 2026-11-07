/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { bootRegistry } from "../../src/model-intelligence/boot"
import { MemoryStorage, StorageManager } from "../../src/model-intelligence/storage"

async function loadedModels(storage: MemoryStorage) {
  const manager = new StorageManager(storage)
  await manager.init()
  return manager.isLoaded() ? (await manager.get()).models : null
}

describe("registry boot", () => {
  test("BootRegistry_NoBoot_RegistryStaysUnloaded", async () => {
    expect(await loadedModels(new MemoryStorage("boot-none"))).toBeNull()
  })

  test("BootRegistry_SyncFails_ServesEmptyRegistry", async () => {
    const storage = new MemoryStorage("boot-offline")
    const { sync } = await bootRegistry({
      syncFromSource: true,
      storage,
      sync: () => Promise.reject(new Error("offline")),
    })
    await sync
    expect(await loadedModels(storage)).toEqual([])
  })

  test("BootRegistry_SyncEnabled_RunsSourceSync", async () => {
    let calls = 0
    const { sync } = await bootRegistry({
      syncFromSource: true,
      storage: new MemoryStorage("boot-sync"),
      sync: async () => {
        calls++
      },
    })
    await sync
    expect(calls).toBe(1)
  })

  test("BootRegistry_E2eMode_SkipsSourceSync", async () => {
    let calls = 0
    const storage = new MemoryStorage("boot-e2e")
    await bootRegistry({
      syncFromSource: false,
      storage,
      sync: async () => {
        calls++
      },
    })
    expect(calls).toBe(0)
    expect(await loadedModels(storage)).toEqual([])
  })
})
