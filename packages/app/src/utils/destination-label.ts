/* SPDX-License-Identifier: MIT */

import type { ShellMode } from "@unifia/workbench-shell/modes"
import type { WorkspaceDestination } from "@/context/mode-directory"

// One name per workspace destination, shared by the topbar crumbs and the
// context panel subtitle (maquette "Prism EQ / Work" and "Prism EQ · Work").
export function destinationLabelKey(destination: WorkspaceDestination, active: ShellMode): string {
  if (destination === "settings") return "sidebar.settings"
  if (destination === "user") return "sidebar.account"
  if (destination === "browser") return "sidebar.rail.browser"
  if (destination === "memory") return "sidebar.rail.memory"
  return `workbench.modes.name.${active}`
}
