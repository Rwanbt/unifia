/* SPDX-License-Identifier: MIT */

import { UnsupportedDesignSchemaVersionError } from "../model/errors"
import { loadDesignDocument } from "../model/migrations"
import type { DesignDocumentRepository } from "../model/repository"
import type { DesignDocumentV1 } from "../model/schema"

/** Web fallback store (ADR-039 section 14); the workspace authority replaces it later. */
export const designDocumentStoragePrefix = "unifia-design-document:v1:"

export type DesignDocumentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

export function createLocalStorageDesignDocumentRepository(
  storage: DesignDocumentStorage = localStorage,
): DesignDocumentRepository {
  const keyFor = (id: string) => `${designDocumentStoragePrefix}${id}`
  return {
    async load(id) {
      const raw = storage.getItem(keyFor(id))
      if (raw === null) return undefined
      try {
        return loadDesignDocument(JSON.parse(raw))
      } catch (error) {
        // A corrupt entry is dropped so the document recovers; a document
        // from a newer schema keeps its bytes untouched (ADR-039 section 16).
        if (!(error instanceof UnsupportedDesignSchemaVersionError)) storage.removeItem(keyFor(id))
        return undefined
      }
    },
    async save(document: DesignDocumentV1) {
      storage.setItem(keyFor(document.id), JSON.stringify(document))
    },
    async remove(id) {
      storage.removeItem(keyFor(id))
    },
  }
}
