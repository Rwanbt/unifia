/* SPDX-License-Identifier: MIT */

// The workspace destinations the rail and the phone bottom bar both offer,
// with the reference's glyphs. One owner, so the two navigations cannot
// drift apart.

import type { ShellMode } from "@unifia/workbench-shell/modes"

// The reference's per-mode rail glyphs (brackets, briefcase, flower,
// workflow; Unifia-UI-UX-v110-PORT-READY-R1.html:15327-15336).
export function modeIcon(mode: ShellMode) {
  if (mode === "code") return "brackets" as const
  if (mode === "work") return "briefcase" as const
  if (mode === "design") return "flower" as const
  return "workflow" as const
}

// Browser and Memory are workspace destinations, not SHELL_MODES. They use
// the same route/selection contract as the four shell modes; keeping them
// outside SHELL_MODES preserves the shared registry invariant.
export const PILL_DESTINATIONS = [
  { id: "browser", icon: "browser", target: "browser" as const, labelKey: "sidebar.rail.browser" },
  { id: "memory", icon: "brain", target: "memory" as const, labelKey: "sidebar.rail.memory" },
] as const
