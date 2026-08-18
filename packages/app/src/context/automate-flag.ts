/* SPDX-License-Identifier: MIT */

// ADR-1041: the dev flag is removed. The Automate surface is now
// reachable from the rail whenever the workspace has `workflow.run`
// granted; it is hidden otherwise. The capability check is the
// gate; this file is a thin compatibility layer for callers that
// still import the previous symbol. New code should consult
// `useWorkspaceWorkbench().grants` directly.

export function isAutomateAccessible(_dev: boolean, _devFlag: boolean): boolean {
  return true
}

export function isAutomateSurfaceReachable(hasCapability: boolean): boolean {
  return hasCapability
}
