/* SPDX-License-Identifier: MIT */

import { createEffect, onCleanup } from "solid-js"
import type { Platform, ServerConnection } from "@unifia/app"
import { checkLocalHealth, writeDebugLog } from "./runtime"
import { createEmbeddedServerRecovery, EMBEDDED_SERVER_HEALTH_POLL_MS } from "./embedded-server-recovery"

export function EmbeddedRuntimeGuardian(props: { platform: Platform; connection: ServerConnection.Any }) {
  createEffect(() => {
    const connection = props.connection
    if (connection.type !== "sidecar" || connection.variant !== "embedded") return
    let active = true
    const port = Number(new URL(connection.http.url).port)
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
    // Keep local available even while the selected remote is unhealthy; never change the active target.
    run()
    const timer = window.setInterval(run, EMBEDDED_SERVER_HEALTH_POLL_MS)
    onCleanup(() => {
      active = false
      window.clearInterval(timer)
    })
  })
  return null
}
