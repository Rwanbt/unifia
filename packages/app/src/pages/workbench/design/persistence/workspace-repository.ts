/* SPDX-License-Identifier: MIT */

import { UnsupportedDesignSchemaVersionError } from "../model/errors"
import { loadDesignDocument } from "../model/migrations"
import type { DesignDocumentRepository } from "../model/repository"
import type { DesignDocumentV1 } from "../model/schema"

/** Where a workspace keeps its canvases: one canonical file per document (ADR-039 section 14). */
export const DESIGN_DOCUMENT_DIRECTORY = ".unifia/design"

export const designDocumentPath = (id: string): string => `${DESIGN_DOCUMENT_DIRECTORY}/${id.replace(/[^A-Za-z0-9._-]/g, "_")}.design.json`

/** Workspace file access, with the content hash the server uses for compare-and-swap writes. */
export interface DesignFileStore {
  /** Resolves to `undefined` when the file does not exist; rejects when the server is unreachable. */
  read(path: string): Promise<{ readonly content: string; readonly hash: string } | undefined>
  /** `expectedHash` is `undefined` to create; the server refuses to overwrite a file that changed since it was read. */
  write(path: string, content: string, expectedHash: string | undefined): Promise<{ readonly hash: string }>
  remove(path: string, expectedHash: string | undefined): Promise<void>
}

/** The stored document is from a newer schema: saving would downgrade it, so nothing is written. */
export class DesignDocumentBlockedError extends Error {
  constructor(id: string) {
    super(`Design document "${id}" was written by a newer version and is left untouched`)
    this.name = "DesignDocumentBlockedError"
  }
}

/**
 * Workspace-backed repository. The `fallback` (localStorage) keeps a safety
 * copy when the workspace cannot be written, and is where documents created
 * before this repository existed are migrated from, once, on first load.
 */
export function createWorkspaceDesignDocumentRepository(
  store: DesignFileStore,
  fallback: DesignDocumentRepository,
): DesignDocumentRepository {
  const hashes = new Map<string, string | undefined>()
  const blocked = new Set<string>()
  // WHY serialised: two overlapping saves would both carry the same hash and the second would be refused as a conflict.
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function persist(document: DesignDocumentV1): Promise<void> {
    if (blocked.has(document.id)) throw new DesignDocumentBlockedError(document.id)
    try {
      const written = await store.write(designDocumentPath(document.id), JSON.stringify(document), hashes.get(document.id))
      hashes.set(document.id, written.hash)
    } catch (error) {
      await fallback.save(document)
      throw error
    }
  }

  async function read(id: string): Promise<DesignDocumentV1 | undefined> {
    let file: Awaited<ReturnType<DesignFileStore["read"]>>
    try {
      file = await store.read(designDocumentPath(id))
    } catch {
      // WHY: an unreachable server must not hide the last local copy.
      return fallback.load(id)
    }
    if (!file) {
      // WHY the swallowed error: the local copy is already the safety net and
      // the next edit retries the write, surfacing the failure in the change bar.
      const legacy = await fallback.load(id)
      if (legacy) await persist(legacy).catch(() => undefined)
      return legacy
    }
    hashes.set(id, file.hash)
    try {
      return loadDesignDocument(JSON.parse(file.content))
    } catch (error) {
      // A newer-schema file keeps its bytes; a corrupt one is replaced by the next save.
      if (error instanceof UnsupportedDesignSchemaVersionError) blocked.add(id)
      return undefined
    }
  }

  return {
    load: (id) => enqueue(() => read(id)),
    save: (document) => enqueue(() => persist(document)),
    async remove(id) {
      await enqueue(async () => {
        await store.remove(designDocumentPath(id), hashes.get(id))
        hashes.delete(id)
      })
      await fallback.remove(id)
    },
  }
}
