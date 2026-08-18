/* SPDX-License-Identifier: MIT */

export {
  DESIGN_SYSTEM_ID_REGEX,
  DESIGN_SECTIONS,
  SKIP_REASONS,
  buildDesignContext,
  importCatalogs,
  normaliseDesignMdPath,
  parseDesignMd,
} from "./index-internal.js"

export type {
  CatalogSource,
  DesignSection,
  ImportedCatalog,
  ImportResult,
  ParsedDesignSystem,
  SkippedCatalog,
  SkipReason,
} from "./index-internal.js"
