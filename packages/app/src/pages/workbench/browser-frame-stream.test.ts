/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import type { WorkbenchConnection } from "@unifia/workbench-shell"
import { FRAME_STREAM_STALE_MS, createBrowserFrameStream } from "@/pages/workbench/browser-frame-stream"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function connectionStreaming(frames: AsyncGenerator<string> | (() => never)): { connection: WorkbenchConnection; opened: string[] } {
  const opened: string[] = []
  const client = {
    browserFrames: (_workspaceId: string, sessionId: string, tabId: string) => {
      opened.push(`${sessionId}:${tabId}`)
      return typeof frames === "function" ? frames() : frames
    },
  }
  return { connection: { client, workspaceId: "ws" } as unknown as WorkbenchConnection, opened }
}

async function* emit(...data: string[]): AsyncGenerator<string> {
  for (const item of data) yield item
  await new Promise(() => {})
}

describe("createBrowserFrameStream", () => {
  test("FrameStream_FramesArrive_ShowsThemAndIsLiveUntilStale", async () => {
    let clock = 1_000
    const shown: string[] = []
    const stream = createBrowserFrameStream((src) => shown.push(src), () => clock)
    const { connection } = connectionStreaming(emit("AAA"))
    stream.follow({ connection, sessionId: "s", tabId: "t", viewportWidth: 390 })
    await settle()
    expect(shown).toEqual(["data:image/jpeg;base64,AAA"])
    expect(stream.isLive()).toBe(true)
    clock += FRAME_STREAM_STALE_MS
    expect(stream.isLive()).toBe(false)
    stream.close()
  })

  test("FrameStream_SameTarget_KeepsOneStream_NewTabReplacesIt", async () => {
    const stream = createBrowserFrameStream(() => {})
    const { connection, opened } = connectionStreaming(emit())
    stream.follow({ connection, sessionId: "s", tabId: "t", viewportWidth: 390 })
    stream.follow({ connection, sessionId: "s", tabId: "t", viewportWidth: 390 })
    stream.follow({ connection, sessionId: "s", tabId: "u", viewportWidth: 390 })
    expect(opened).toEqual(["s:t", "s:u"])
    stream.close()
  })

  test("FrameStream_ServerCannotStream_StopsTryingAndPollingStays", async () => {
    const stream = createBrowserFrameStream(() => {})
    const unsupported = Object.assign(new Error("workbench request failed: 501"), { status: 501 })
    const { connection, opened } = connectionStreaming(() => {
      throw unsupported
    })
    stream.follow({ connection, sessionId: "s", tabId: "t", viewportWidth: 390 })
    await settle()
    stream.follow({ connection, sessionId: "s", tabId: "u", viewportWidth: 390 })
    expect(opened).toEqual(["s:t"])
    expect(stream.isLive()).toBe(false)
  })
})
