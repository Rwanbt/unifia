/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { createSignal } from "solid-js"
import { createSimpleContext } from "@unifia/ui/context"

/**
 * WHY a dedicated context instead of the shared DialogOutlet (#82):
 * <DialogOutlet /> renders at RouterRoot, above every directory-scoped
 * provider, so a Team dialog opened through it cannot call useTeam().
 * The shell command that opens Team lives in Layout (root), while
 * TeamProvider only wraps DirectoryLayout. This context carries the
 * open flag across that gap; the dialog itself is rendered by
 * <TeamDialogHost /> INSIDE TeamProvider's scope.
 */
export const { use: useTeamDialog, provider: TeamDialogProvider } = createSimpleContext({
  name: "TeamDialog",
  init: () => {
    const [opened, setOpened] = createSignal(false)
    return {
      opened,
      open: () => setOpened(true),
      close: () => setOpened(false),
    }
  },
})