/* SPDX-License-Identifier: MIT */

import { DESIGN_SCHEMA_VERSION, type DesignDocumentV1 } from "./schema"

export function createDesignDocument(id: string, name: string): DesignDocumentV1 {
  return { schemaVersion: DESIGN_SCHEMA_VERSION, id, name, rootIds: [], nodes: {} }
}
