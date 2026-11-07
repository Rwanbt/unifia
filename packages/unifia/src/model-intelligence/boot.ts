/* SPDX-License-Identifier: MIT */

/**
 * Registry boot for `unifia serve`.
 *
 * The registry lives in process memory and nothing else fills it in the
 * server process, so without this every `/model-intelligence/*` request
 * answered 503 for the life of the process (the e2e seed hid it).
 *
 * Order matters: the empty seed must reach storage before the first request,
 * because LiveRegistryLayer reads storage once when it is first built. The
 * source sync then replaces it in place through the same memoised layer. It
 * runs in the background so an offline boot still serves an empty page.
 */

import { makeRuntime } from "../effect/run-service"
import { Log } from "../util/log"
import { Registry, LiveRegistryLayer, defaultStorage } from "./registry"
import { seedEmptyRegistry } from "./empty-registry"
import type { StorageBackend } from "./storage"

const log = Log.create({ service: "model-intelligence.boot" })

export interface RegistryBootOptions {
  syncFromSource: boolean
  storage?: StorageBackend
  sync?: () => Promise<unknown>
}

function syncLiveRegistry(): Promise<unknown> {
  const { runPromise } = makeRuntime(Registry, LiveRegistryLayer)
  return runPromise((registry) => registry.sync())
}

/** Resolves once the seed is stored; the source sync, if any, keeps running. */
export async function bootRegistry(options: RegistryBootOptions): Promise<{ sync: Promise<void> }> {
  await seedEmptyRegistry(options.storage ?? defaultStorage)
  if (!options.syncFromSource) return { sync: Promise.resolve() }
  const sync = (options.sync ?? syncLiveRegistry)().then(
    () => log.info("model registry synced from source"),
    (error: unknown) =>
      log.warn("model registry sync failed; serving the empty registry", {
        error: error instanceof Error ? error.message : String(error),
      }),
  )
  return { sync }
}
