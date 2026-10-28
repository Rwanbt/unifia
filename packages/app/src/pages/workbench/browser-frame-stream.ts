/* SPDX-License-Identifier: MIT */
import { BROWSER_FRAME_CONTENT_TYPE } from "@unifia/contracts/browser"
import type { WorkbenchConnection } from "@unifia/workbench-shell"

/** Without a frame for this long the poll takes screenshots again: the stream may be gone, or the page idle. */
export const FRAME_STREAM_STALE_MS = 3_000
/** Gap before reopening a stream that failed, so a broken route does not cost a request per poll tick. */
const FRAME_STREAM_RETRY_MS = 5_000
/** HTTP status of a server whose Browser host cannot stream: screenshot polling is the only path, for good. */
const STREAM_UNSUPPORTED_STATUS = 501

type StreamTarget = { connection: WorkbenchConnection; sessionId: string; tabId: string; viewportWidth: number }

/**
 * Keeps one live frame stream open for the displayed tab. The poll asks `isLive()` to decide whether a
 * screenshot is still needed; the stream itself never decides what is displayed beyond pushing frames.
 */
export function createBrowserFrameStream(onFrame: (src: string) => void, now: () => number = Date.now) {
  let key = ""
  let abort: AbortController | undefined
  let lastFrameAt = 0
  let retryAfter = 0
  let unsupported = false

  const close = () => {
    abort?.abort()
    abort = undefined
    key = ""
  }

  const open = (target: StreamTarget) => {
    const controller = new AbortController()
    abort = controller
    void (async () => {
      try {
        const frames = target.connection.client.browserFrames(target.connection.workspaceId, target.sessionId, target.tabId, controller.signal)
        for await (const data of frames) {
          if (controller.signal.aborted) return
          lastFrameAt = now()
          onFrame(`data:${BROWSER_FRAME_CONTENT_TYPE};base64,${data}`)
        }
      } catch (reason) {
        if (controller.signal.aborted) return
        if ((reason as { status?: number }).status === STREAM_UNSUPPORTED_STATUS) unsupported = true
        console.warn("[browser] frame stream ended", reason instanceof Error ? reason.message : String(reason))
      }
      // Ended on its own: let the next poll tick reopen it after the retry gap.
      if (abort === controller) {
        abort = undefined
        key = ""
        retryAfter = now() + FRAME_STREAM_RETRY_MS
      }
    })()
  }

  return {
    /** Opens, keeps or replaces the stream so it follows the tab and page size being displayed. */
    follow(target: StreamTarget | undefined) {
      if (unsupported) return
      const next = target ? `${target.sessionId}:${target.tabId}:${target.viewportWidth}` : ""
      if (next === key) return
      close()
      if (!target || now() < retryAfter) return
      key = next
      lastFrameAt = 0
      open(target)
    },
    /** Whether frames arrived recently enough that a polled screenshot would only repeat them. */
    isLive(): boolean {
      return abort !== undefined && now() - lastFrameAt < FRAME_STREAM_STALE_MS
    },
    close,
  }
}
