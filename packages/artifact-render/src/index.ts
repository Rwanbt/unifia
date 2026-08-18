/* SPDX-License-Identifier: MIT */

export { buildSrcdoc, type SrcdocOptions } from "./srcdoc"
export { STORAGE_SHIM_SCRIPT } from "./bridges/storage-shim"
export { FOCUS_GUARD_SCRIPT } from "./bridges/focus-guard"
export {
  htmlNeedsFocusGuard,
  htmlNeedsStorageShim,
  shouldUrlLoad,
  type RenderDecision,
} from "./render-mode"
export {
  createArtifactParser,
  type ArtifactEvent,
} from "./stream-parser"
export { resolveRenderer } from "./renderer-registry"
export {
  DEFAULT_VIEWPORT,
  DEFAULT_ZOOM,
  VIEWPORT_IDS,
  VIEWPORT_PRESETS,
  ZOOM_PRESETS,
  effectiveScale,
  findViewport,
  fitScale,
  type ViewportId,
  type ViewportPreset,
} from "./viewport"
export {
  INLINEABLE_PROPERTIES,
  SNAPSHOT_BRIDGE_SCRIPT,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_TIMEOUT_MS,
  looksBlank,
  type Rgba,
  type SnapshotError,
  type SnapshotErrorCode,
  type SnapshotMessage,
  type SnapshotRequest,
  type SnapshotResult,
} from "./bridges/snapshot"
export {
  ANCESTOR_FOR_DIV,
  EXCLUDED_TAGS,
  STRUCTURAL_TAGS,
  annotateSelectableElements,
  computePathId,
} from "./annotate"
export {
  SELECTION_BRIDGE_SCRIPT,
  type SelectionMessage,
  type SelectModeRequest,
  type SelectTargetMessage,
} from "./bridges/selection"
