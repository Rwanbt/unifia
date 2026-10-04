import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"

export type SSEEvent =
  | { type: "session.updated"; properties?: { status?: string; title?: string; id?: string } }
  | { type: "llm.status"; properties?: { event?: string; model?: string } }
  | { type: string; properties?: Record<string, string> }

async function ensurePermission(): Promise<boolean> {
  let granted = await isPermissionGranted()
  if (!granted) {
    const perm = await requestPermission()
    granted = perm === "granted"
  }
  return granted
}

function trySend(title: string, body: string) {
  try {
    sendNotification({ title, body })
  } catch (error) {
    console.error("Mobile notification failed", error)
  }
}

/**
 * Mobile notification bridge.
 * Subscribes to the server's SSE event stream and triggers native push
 * notifications when the app is in the background.
 *
 * Usage:
 *   const bridge = new NotificationBridge(subscribe)
 *   await bridge.connect()          // call once on app ready
 *   bridge.disconnect()             // call in onCleanup
 */
export class NotificationBridge {
  private unsubscribe: (() => void) | undefined
  private disposed = false
  private granted = false
  private isBackground = false
  private visibilityHandler: (() => void) | null = null

  constructor(private subscribe: (handler: (event: SSEEvent) => void) => () => void) {}

  async connect() {
    this.granted = await ensurePermission()
    if (this.disposed) return

    this.isBackground = document.visibilityState === "hidden"
    this.visibilityHandler = () => {
      this.isBackground = document.visibilityState === "hidden"
    }
    document.addEventListener("visibilitychange", this.visibilityHandler)

    // Reuse the selected SDK's authenticated transport, including native TLS handling.
    this.unsubscribe = this.subscribe((event) => this.handleEvent(event))
  }

  private handleEvent(data: SSEEvent) {
    if (this.disposed || !this.isBackground || !this.granted) return

    if (data.type === "session.updated") {
      const { status, title } = data.properties ?? {}
      if (status === "completed") {
        trySend("Task Complete", title || "A background task has finished.")
      } else if (status === "failed") {
        trySend("Task Failed", title || "A background task has failed.")
      }
    } else if (data.type === "llm.status") {
      const { event: evt, model } = data.properties ?? {}
      if (evt === "loaded") {
        trySend("Model Ready", model ? `${model} is loaded and ready.` : "Local model is ready.")
      }
    }
  }

  disconnect() {
    this.disposed = true
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler)
      this.visibilityHandler = null
    }
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }
}
