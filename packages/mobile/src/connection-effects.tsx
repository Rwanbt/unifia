/* SPDX-License-Identifier: MIT */

import { createEffect, onCleanup } from "solid-js"
import { useGlobalSDK, useServer, type Platform, type ServerConnection } from "@unifia/app"
import { NotificationBridge, type SSEEvent } from "./notifications"
import { checkLocalHealth, writeDebugLog } from "./runtime"
import { createEmbeddedServerRecovery, EMBEDDED_SERVER_HEALTH_POLL_MS } from "./embedded-server-recovery"

export function MobileConnectionEffects(props: {
  platform: Platform
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

    if (connection.type !== "sidecar" || connection.variant !== "embedded") return
    let active = true
    const port = Number(new URL(connection.http.url).port || "14096")
    const poll = createEmbeddedServerRecovery({
      checkHealth: () => checkLocalHealth(port, connection.http.password),
      restart: async () => {
        if (active) await props.platform.startLocalServer?.()
      },
    })
    const run = () => {
      void poll().catch((error) => {
        console.error("Embedded server recovery failed", error)
        void writeDebugLog(`Embedded server recovery failed: ${String(error)}`)
      })
    }
    run()
    const timer = window.setInterval(run, EMBEDDED_SERVER_HEALTH_POLL_MS)
    onCleanup(() => {
      active = false
      window.clearInterval(timer)
    })
  })
  return null
}
