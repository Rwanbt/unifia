/* SPDX-License-Identifier: MIT */
import type { Page } from "playwright"
import { DEFAULT_REDACT_SELECTORS } from "@unifia/contracts/browser"

const SENSITIVE_SELECTOR = DEFAULT_REDACT_SELECTORS.join(",")
const SCREENCAST_JPEG_QUALITY = 70
/** Chromium paints up to 60 times a second; every other paint is smooth on a phone and halves the encode work. */
const SCREENCAST_EVERY_NTH_FRAME = 2
const SENSITIVE_SEEN_FLAG = "__unifiaSensitiveSeen"

/**
 * Raises a per-document flag the first time a redacted field exists, and keeps it raised even if the field
 * is removed. Screencast frames cannot be masked, so a document that ever held such a field is captured
 * through the masked screenshot path instead (Gate B: never an unredacted capture by default).
 */
export const SENSITIVE_FIELD_WATCH_SCRIPT = `(() => {
  const selector = ${JSON.stringify(SENSITIVE_SELECTOR)};
  const check = () => { if (document.querySelector(selector)) window[${JSON.stringify(SENSITIVE_SEEN_FLAG)}] = true };
  new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true });
  check();
})()`

export type ScreencastOptions = {
  maxWidth: number
  maxHeight: number
  onFrame: (jpeg: Uint8Array) => void
  /** The masked capture used whenever the document holds, or held, a redacted field. */
  maskedCapture: () => Promise<Uint8Array>
}

async function holdsSensitiveField(page: Page): Promise<boolean> {
  return page
    .evaluate<boolean>(`window[${JSON.stringify(SENSITIVE_SEEN_FLAG)}] === true || document.querySelector(${JSON.stringify(SENSITIVE_SELECTOR)}) !== null`)
    // WHY: a navigation can destroy the context mid-check; an unknown answer must take the masked path.
    .catch(() => true)
}

/** Streams the page as it paints. Returns the function that stops the stream. */
export async function startPageScreencast(page: Page, options: ScreencastOptions): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page)
  let busy = false
  let stopped = false
  cdp.on("Page.screencastFrame", (frame: { data: string; sessionId: number }) => {
    // Acknowledge first: Chromium sends the next frame only once the previous one is acknowledged.
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined)
    // Frames that arrive while one is being checked are dropped; the next paint carries newer pixels anyway.
    if (busy || stopped) return
    busy = true
    void (async () => {
      try {
        const bytes = (await holdsSensitiveField(page)) ? await options.maskedCapture() : Buffer.from(frame.data, "base64")
        if (!stopped) options.onFrame(bytes)
      } catch {
        // WHY: a capture that loses a race with navigation is superseded by the next painted frame.
      } finally {
        busy = false
      }
    })()
  })
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: SCREENCAST_JPEG_QUALITY,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    everyNthFrame: SCREENCAST_EVERY_NTH_FRAME,
  })
  return async () => {
    if (stopped) return
    stopped = true
    await cdp.send("Page.stopScreencast").catch(() => undefined)
    await cdp.detach().catch(() => undefined)
  }
}
