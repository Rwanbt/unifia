/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { createComponent, createEffect, createSignal, Show, type Component, type JSX } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Dialog } from "@unifia/ui/dialog"
import { useTeamDialog } from "@/context/team-dialog"

/**
 * Renders the Team dialog inside TeamProvider's scope (#82).
 *
 * Same Kobalte + Dialog + overlay assembly the shared <DialogOutlet/>
 * uses, but mounted from DirectoryLayout - under TeamProvider - so the
 * content's useTeam() resolves. The command that opens it (Layout's
 * `openTeam`) only sets the context flag; without a directory there is
 * no host and no Team data, so the command is a no-op there.
 *
 * The content is lazy-imported so the Team bundle stays out of the
 * initial payload, mirroring the shell's other dialogs.
 */
export function TeamDialogHost(): JSX.Element {
  const dialog = useTeamDialog()
  const [content, setContent] = createSignal<Component>()
  createEffect(() => {
    if (!dialog.opened() || content()) return
    void import("@/components/dialog-team").then((mod) => setContent(() => mod.TeamDialogContent))
  })
  return (
    <Show when={dialog.opened() && content()}>
      {(loaded) => (
        <Kobalte modal open onOpenChange={(open: boolean) => { if (!open) dialog.close() }}>
          <Kobalte.Portal>
            <Kobalte.Overlay data-component="dialog-overlay" onClick={() => dialog.close()} />
            <Dialog size="x-large" transition>
              {createComponent(loaded(), {})}
            </Dialog>
          </Kobalte.Portal>
        </Kobalte>
      )}
    </Show>
  )
}