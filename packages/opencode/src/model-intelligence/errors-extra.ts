/**
 * Erreurs supplémentaires — fichier séparé pour éviter les cycles d'import.
 * (errors.ts importe schema-version ; snapshot.ts importe errors-extra.)
 */

import { NamedError } from "@opencode-ai/util/error"
import z from "zod"

export const SnapshotCorruptedError = NamedError.create(
  "SnapshotCorruptedError",
  z.object({
    expectedHash: z.string(),
    actualHash: z.string(),
    path: z.string(),
    message: z.string(),
  }),
)

export const SnapshotHashMismatchError = NamedError.create(
  "SnapshotHashMismatchError",
  z.object({
    expectedHash: z.string(),
    actualHash: z.string(),
    path: z.string(),
  }),
)

export const UnsupportedSchemaVersionError = NamedError.create(
  "UnsupportedSchemaVersionError",
  z.object({
    found: z.string(),
    currentVersion: z.string(),
    message: z.string(),
  }),
)