/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createDesignDocument } from "./document"
import { UnsupportedDesignSchemaVersionError } from "./errors"
import { doc, expectError, rect } from "./fixtures"
import { loadDesignDocument, migrateDesignDocument, schemaVersionOf, type DesignMigration } from "./migrations"
import { DESIGN_SCHEMA_VERSION } from "./schema"

describe("design document migrations", () => {
  test("the current version passes through untouched", () => {
    const current = doc([rect("a")])
    expect(migrateDesignDocument(current)).toBe(current)
  })

  test("a document without an integer schemaVersion is refused", () => {
    expect(expectError(() => migrateDesignDocument({ nodes: {} })).code).toBe("missing-schema-version")
    expect(expectError(() => migrateDesignDocument({ schemaVersion: "1", nodes: {} })).code).toBe(
      "missing-schema-version",
    )
  })

  test("a newer schema version is refused with the raw value preserved", () => {
    const future = { ...doc([rect("a")]), schemaVersion: 99 }
    const error = expectError(() => migrateDesignDocument(future))
    expect(error).toBeInstanceOf(UnsupportedDesignSchemaVersionError)
    expect((error as UnsupportedDesignSchemaVersionError).raw).toBe(future)
  })

  test("a declared version without a migration path is refused", () => {
    expect(expectError(() => migrateDesignDocument({ schemaVersion: 0, nodes: {} })).code).toBe("no-migration-path")
  })

  test("an injected migration chain is applied sequentially", () => {
    const steps: readonly DesignMigration[] = [
      { from: 0, to: 1, migrate: (value) => ({ ...(value as object), schemaVersion: 1, nodes: {} }) },
      { from: 1, to: DESIGN_SCHEMA_VERSION, migrate: () => doc([rect("a")]) },
    ]
    const raw = { schemaVersion: 0, legacy: true }
    expect(migrateDesignDocument(raw, steps)).toEqual(doc([rect("a")]))
    const loaded = loadDesignDocument(raw, steps)
    expect(loaded.nodes.a.id).toBe("a")
  })

  test("a non-monotonic migration chain is refused instead of looping", () => {
    const broken: DesignMigration = { from: 0, to: 0, migrate: (value) => value }
    expect(expectError(() => migrateDesignDocument({ schemaVersion: 0 }, [broken])).code).toBe("no-migration-path")
  })

  test("schemaVersionOf only accepts integers", () => {
    expect(schemaVersionOf({ schemaVersion: 1 })).toBe(1)
    expect(schemaVersionOf({ schemaVersion: 1.5 })).toBeUndefined()
    expect(schemaVersionOf(null)).toBeUndefined()
    expect(schemaVersionOf("nope")).toBeUndefined()
  })

  test("loadDesignDocument validates the migrated document", () => {
    const loaded = loadDesignDocument(createDesignDocument("doc", "Doc"))
    expect(loaded.id).toBe("doc")
    expect(expectError(() => loadDesignDocument({ schemaVersion: 1, nodes: {} })).code).toBe("invalid-document")
  })

  test("v1 documents migrate to v2 and keep their nodes and comments", () => {
    const v1 = { ...doc([rect("a")]), schemaVersion: 1 }
    const withoutComments = migrateDesignDocument(v1)
    expect(schemaVersionOf(withoutComments)).toBe(2)
    const withComments = {
      ...v1,
      comments: [{ id: "c1", nodeId: "a", x: 1, y: 2, note: "hi", status: "open", createdAt: "2026-09-16T00:00:00.000Z" }],
    }
    const loaded = loadDesignDocument(withComments)
    expect(loaded.nodes.a.id).toBe("a")
    expect(loaded.comments?.[0]).toMatchObject({ id: "c1", nodeId: "a", note: "hi" })
  })
})
