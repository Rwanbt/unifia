/* SPDX-License-Identifier: MIT */

export type DesignDocumentErrorCode =
  | "invalid-document"
  | "invalid-legacy-snapshot"
  | "missing-schema-version"
  | "unsupported-schema-version"
  | "no-migration-path"
  | "node-not-found"
  | "comment-not-found"
  | "parent-not-found"
  | "parent-not-container"
  | "duplicate-id"
  | "node-locked"
  | "target-locked"
  | "cycle"
  | "invalid-transform"
  | "invalid-points"
  | "invalid-command"
  | "not-editable"
  | "invalid-child-ids"
  | "missing-new-id"

export class DesignDocumentError extends Error {
  readonly code: DesignDocumentErrorCode

  constructor(code: DesignDocumentErrorCode, message: string) {
    super(message)
    this.name = "DesignDocumentError"
    this.code = code
  }
}

/**
 * A document whose `schemaVersion` is newer than this runtime understands.
 * The raw value is carried untouched so callers can preserve the original
 * bytes instead of downgrading or rewriting them (ADR-039 section 16).
 */
export class UnsupportedDesignSchemaVersionError extends DesignDocumentError {
  readonly raw: unknown

  constructor(version: unknown, raw: unknown) {
    super("unsupported-schema-version", `unsupported design schema version: ${String(version)}`)
    this.name = "UnsupportedDesignSchemaVersionError"
    this.raw = raw
  }
}
