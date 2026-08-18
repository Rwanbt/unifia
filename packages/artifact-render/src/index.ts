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
