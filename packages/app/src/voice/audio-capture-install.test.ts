/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { installAudioCaptureCoordinator, requestAudioCapture } from "./audio-capture-coordinator"

describe("audio capture coordinator installation", () => {
  test("installing twice on one window still grants the capture to one owner at a time", () => {
    const win = new EventTarget() as unknown as Window
    const first = installAudioCaptureCoordinator(win)
    const second = installAudioCaptureCoordinator(win)

    const lease = requestAudioCapture(win, "dictation", () => {})
    expect(lease).toBeDefined()
    expect(requestAudioCapture(win, "dictation", () => {})).toBeUndefined()

    lease?.release()
    expect(requestAudioCapture(win, "dictation", () => {})).toBeDefined()

    first()
    second()
  })

  test("the window is released only when every installation has been removed", () => {
    const win = new EventTarget() as unknown as Window
    const first = installAudioCaptureCoordinator(win)
    const second = installAudioCaptureCoordinator(win)
    first()

    expect(requestAudioCapture(win, "dictation", () => {})).toBeDefined()
    second()
  })
})
