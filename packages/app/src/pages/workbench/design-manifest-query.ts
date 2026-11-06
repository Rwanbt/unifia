/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { WorkbenchHttpError } from "@unifia/workbench-shell"

/**
 * A workspace that has no design-system manifest yet answers 404. That is the
 * normal state of a new workspace, not a failure: the spec editor showed the
 * raw "workbench request failed: 404" there, and the query retried it. It now
 * reads as "no catalog yet", the empty state the editor already has.
 */
export async function designManifestOrEmpty<T extends object>(load: () => Promise<T>): Promise<T | { designSystems: readonly [] }> {
  try {
    return await load()
  } catch (error) {
    if (error instanceof WorkbenchHttpError && error.status === 404) return { designSystems: [] }
    throw error
  }
}
