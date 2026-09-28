/* SPDX-License-Identifier: MIT */

import type { DesignFileStore } from "./workspace-repository"

type Stamped = { readonly content: string; readonly stamp: { readonly hash: string } }
type Result<T> = { readonly data?: T; readonly error?: unknown; readonly response?: { readonly status: number } }

/** The slice of the SDK's `client.file` the design store needs. */
export interface SdkFileClient {
  readRaw(input: { path: string }): Promise<Result<Stamped>>
  write(input: { path: string; content: string; expectedHash?: string }): Promise<Result<Stamped>>
  delete(input: { path: string; expectedHash?: string }): Promise<Result<{ deleted: boolean }>>
}

const NOT_FOUND = 404
const CONFLICT = 409

/** Adapts the project file API (the one Memory and the editor use) to the design store contract. */
export function createSdkDesignFileStore(file: SdkFileClient): DesignFileStore {
  return {
    async read(path) {
      const result = await file.readRaw({ path })
      if (result.response?.status === NOT_FOUND) return undefined
      if (!result.data) throw new Error(`Could not read ${path}`)
      return { content: result.data.content, hash: result.data.stamp.hash }
    },
    async write(path, content, expectedHash) {
      const result = await file.write({ path, content, ...(expectedHash === undefined ? {} : { expectedHash }) })
      if (!result.data) throw new Error(result.response?.status === CONFLICT ? `${path} changed on disk since it was loaded` : `Could not write ${path}`)
      return { hash: result.data.stamp.hash }
    },
    async remove(path, expectedHash) {
      const result = await file.delete({ path, ...(expectedHash === undefined ? {} : { expectedHash }) })
      if (result.error) throw new Error(`Could not remove ${path}`)
    },
  }
}
