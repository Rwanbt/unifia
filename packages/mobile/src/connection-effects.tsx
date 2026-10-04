/* SPDX-License-Identifier: MIT */

import { createEffect, onCleanup } from "solid-js"
import { useGlobalSDK, useServer, type ServerConnection } from "@unifia/app"
import { NotificationBridge, type SSEEvent } from "./notifications"

export function MobileConnectionEffects(props: {
  onConnection: (connection: ServerConnection.Any) => void
}) {
  const server = useServer()
  const sdk = useGlobalSDK()
  createEffect(() => {
    const connection = server.current
    if (!connection) return
    props.onConnection(connection)
    const bridge = new NotificationBridge((handler) => sdk.event.listen((event) => handler(event.details as SSEEvent)))
    void bridge.connect().catch((error) => {
      console.error("Mobile notification subscription failed", error)
    })
    onCleanup(() => bridge.disconnect())

  })
  return null
}
