// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import type { E2EWindow } from "./terminal"

export const projectRowsEnabled = () => {
  if (typeof window === "undefined") return false
  return (window as E2EWindow).__opencode_e2e?.projects?.enabled === true
}

// Hands the project list's own reorder action to the e2e harness, so a test can change the
// order while a row's menu is open. Inert unless the harness enabled it; the product never reads it.
export function registerProjectRowsProbe(move: (directory: string, toIndex: number) => void) {
  if (!projectRowsEnabled()) return
  const win = window as E2EWindow
  if (!win.__opencode_e2e?.projects) return
  win.__opencode_e2e.projects.move = move
}
