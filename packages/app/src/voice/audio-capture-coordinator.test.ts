import { afterEach, describe, expect, test } from "bun:test"
import {
  acquireCurrentAudioStream,
  cancelAudioCaptureRequest,
  installAudioCaptureCoordinator,
  requestAudioCapture,
} from "./audio-capture-coordinator"

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe("AudioCaptureCoordinator", () => {
  test("live preempts dictation and stale leases cannot release it", () => {
    cleanups.push(installAudioCaptureCoordinator(window))
    const stopped: string[] = []
    const dictation = requestAudioCapture(window, "dictation", () => stopped.push("dictation"))!
    const live = requestAudioCapture(window, "live", () => stopped.push("live"))!

    expect(stopped).toEqual(["dictation"])
    expect(dictation.isCurrent()).toBe(false)
    expect(live.isCurrent()).toBe(true)
    dictation.release()
    expect(live.isCurrent()).toBe(true)
  })

  test("dictation and voice-clone capture cannot compete", () => {
    cleanups.push(installAudioCaptureCoordinator(window))
    const stopped: string[] = []
    const dictation = requestAudioCapture(window, "dictation", () => stopped.push("dictation"))!

    expect(requestAudioCapture(window, "voice-clone", () => stopped.push("voice-clone"))).toBeUndefined()
    expect(dictation.isCurrent()).toBe(true)
    expect(stopped).toEqual([])
  })

  test("failed preemption leaves the existing capture owner current", () => {
    cleanups.push(installAudioCaptureCoordinator(window))
    const dictation = requestAudioCapture(window, "dictation", () => { throw new Error("stop failed") })!

    expect(() => requestAudioCapture(window, "live", () => undefined)).toThrow("stop failed")
    expect(dictation.isCurrent()).toBe(true)
  })

  test("stopping a pending request closes its late stream", async () => {
    cleanups.push(installAudioCaptureCoordinator(window))
    const lease = requestAudioCapture(window, "dictation", () => undefined)!
    let resolveStream!: (stream: MediaStream) => void
    const streamPromise = new Promise<MediaStream>((resolve) => { resolveStream = resolve })
    const pendingCapture = acquireCurrentAudioStream(lease, () => streamPromise)
    cancelAudioCaptureRequest(lease)
    let stopped = false
    const stream = {
      getTracks: () => [{ stop: () => { stopped = true } }],
    } as unknown as MediaStream

    resolveStream(stream)

    expect(await pendingCapture).toBeUndefined()
    expect(stopped).toBe(true)
    expect(lease.isCurrent()).toBe(false)
  })
})
