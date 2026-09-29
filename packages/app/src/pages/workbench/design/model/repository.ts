/* SPDX-License-Identifier: MIT */

import type { DesignDocumentV1 } from "./schema"

/**
 * Persistence boundary for canonical design documents (ADR-039 section 14).
 * Implementations live outside the model layer: the temporary localStorage
 * web fallback and the workspace/artifact target both implement this
 * contract, so the storage swap never reaches the canvas or the document
 * format.
 */
export interface DesignDocumentRepository {
  /** Resolves to `undefined` when no document is stored under `id`. */
  load(id: string): Promise<DesignDocumentV1 | undefined>
  save(document: DesignDocumentV1): Promise<void>
  remove(id: string): Promise<void>
}
