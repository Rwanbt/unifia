/* SPDX-License-Identifier: MIT */

import { DesignDocumentError, UnsupportedDesignSchemaVersionError } from "./errors"
import { DESIGN_SCHEMA_VERSION, type DesignDocumentV1 } from "./schema"
import { parseDesignDocument } from "./validation"

export type DesignMigration = {
  from: number
  to: number
  migrate: (document: unknown) => unknown
}

/**
 * The format is at v2 (comments were added as an optional document field,
 * ADR-039 section 31). The bump matters even though the field is optional:
 * `strictObject` would make an older runtime reject a document carrying
 * comments as invalid, while a newer version makes it refuse cleanly and keep
 * the bytes untouched (section 16). Each future schema change adds exactly
 * one entry here; `from`/`to` must form a contiguous chain up to
 * DESIGN_SCHEMA_VERSION.
 */
export const designMigrations: readonly DesignMigration[] = [
  {
    from: 1,
    to: 2,
    // v2 adds an optional `comments` array: existing v1 documents are already
    // valid v2 documents once the version is stamped.
    migrate: (document) =>
      typeof document === "object" && document !== null ? { ...document, schemaVersion: 2 } : document,
  },
]

export function schemaVersionOf(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const value = (raw as { schemaVersion?: unknown }).schemaVersion
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined
  return value
}

/**
 * Detects the declared version and applies migrations sequentially. A
 * version newer than this runtime understands is refused untouched; the
 * error carries the raw value so callers can preserve the original bytes.
 */
export function migrateDesignDocument(raw: unknown, migrations: readonly DesignMigration[] = designMigrations): unknown {
  const version = schemaVersionOf(raw)
  if (version === undefined) {
    throw new DesignDocumentError("missing-schema-version", "design document has no integer schemaVersion")
  }
  if (version > DESIGN_SCHEMA_VERSION) throw new UnsupportedDesignSchemaVersionError(version, raw)
  let current = raw
  let at = version
  while (at < DESIGN_SCHEMA_VERSION) {
    const step = migrations.find((migration) => migration.from === at)
    if (!step || step.to <= at) {
      throw new DesignDocumentError("no-migration-path", `no design migration path from version ${at}`)
    }
    current = step.migrate(current)
    at = step.to
  }
  return current
}

export function loadDesignDocument(raw: unknown, migrations: readonly DesignMigration[] = designMigrations): DesignDocumentV1 {
  return parseDesignDocument(migrateDesignDocument(raw, migrations))
}
