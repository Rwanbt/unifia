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
 * v1 is the current format, so there are no deltas yet. Each future schema
 * change adds exactly one entry here; `from`/`to` must form a contiguous
 * chain up to DESIGN_SCHEMA_VERSION (ADR-039 section 16).
 */
export const designMigrations: readonly DesignMigration[] = []

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
