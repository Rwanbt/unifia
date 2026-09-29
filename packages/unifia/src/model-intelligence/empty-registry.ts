/* SPDX-License-Identifier: MIT */

/**
 * Empty registry seed for the hermetic e2e boot (#92).
 *
 * The server never syncs the model-intelligence registry in tests, so
 * `/model-intelligence/models` answered 503 on every boot and each page load
 * logged the failed resource. `seedEmptyRegistry()` stores a schema-valid
 * empty registry in the in-process default storage so the route answers an
 * empty page instead.
 *
 * This lives in the package (not in `packages/app/script/e2e-local.ts`) so
 * the payload is unit-tested against the schema: a registry that fails
 * `Registry.parse` must fail the test, not silently boot an invalid state.
 */

import { createHash } from "node:crypto"
import { Registry as RegistrySchema, isoUtcNow, type Registry as RegistryT } from "./schema"
import { SCHEMA_VERSION } from "./schema-version"
import { defaultStorage } from "./registry"
import type { StorageBackend } from "./storage"

export function emptyRegistry(generatorVersion: string = "e2e"): RegistryT {
  const now = isoUtcNow()
  return RegistrySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    generatedAtUTC: now,
    generatorVersion,
    registryID: createHash("sha256").update(`empty-registry:${generatorVersion}`).digest("hex"),
    sources: [],
    providers: [],
    models: [],
    aliases: [],
    health: {
      snapshotAtUTC: now,
      totalProviders: 0,
      totalModels: 0,
      activeModels: 0,
      deprecatedModels: 0,
      missingPricingModels: 0,
      aliasesResolved: 0,
    },
    provenance: [],
  })
}

export async function seedEmptyRegistry(storage: StorageBackend = defaultStorage): Promise<void> {
  await storage.save(emptyRegistry())
}
