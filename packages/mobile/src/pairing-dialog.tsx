/* SPDX-License-Identifier: MIT */

import { createEffect } from "solid-js"
import { useDialog } from "@unifia/ui/context/dialog"
import { DialogSelectServer, type ServerConnection } from "@unifia/app"

export function MobilePairingDialog(props: {
  pairing: ServerConnection.HttpBase | null
  onConsumed: () => void
}) {
  const dialog = useDialog()
  createEffect(() => {
    const pairing = props.pairing
    if (!pairing) return
    props.onConsumed()
    // A hostile page can send a deep link: keep health checks and explicit confirmation.
    dialog.show(() => <DialogSelectServer initialServer={pairing} />)
  })
  return null
}
