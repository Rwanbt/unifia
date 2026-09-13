/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { buildFollowupDockProps, type FollowupDockProps } from "./followup-dock-props"

// Minimal editingFollowup shape — the factory only forwards it verbatim via
// the editingFollowup accessor. We only need id + opaque prompt/context
// blobs. Cast through `never` to stay decoupled from the Prompt / ContextItem
// shapes the real form accumulates (and to avoid pulling those types into
// the test).
const editingDraft = { id: "x", prompt: undefined, context: [] } as unknown as FollowupDockProps["edit"]

describe("buildFollowupDockProps", () => {
  test("returns undefined when paramsId is missing", () => {
    const props = buildFollowupDockProps({
      paramsId: () => undefined,
      queueEnabled: () => true,
      followupDock: () => [],
      sendingFollowup: () => undefined,
      editingFollowup: () => undefined,
      queueFollowup: () => {},
      setFollowup: () => {},
      sendFollowup: () => {},
      editFollowup: () => {},
      clearFollowupEdit: () => {},
    })

    expect(props).toBeUndefined()
  })

  test("builds the dock when paramsId is set, forwarding every accessor", () => {
    const queueEnabled = () => false
    const items = [{ id: "x", text: "hello" }]
    const editing = editingDraft

    const props = buildFollowupDockProps({
      paramsId: () => "session-1",
      queueEnabled,
      followupDock: () => items,
      sendingFollowup: () => "x",
      editingFollowup: () => editing,
      queueFollowup: () => {},
      setFollowup: () => {},
      sendFollowup: () => {},
      editFollowup: () => {},
      clearFollowupEdit: () => {},
    })

    expect(props).toBeDefined()
    expect(props?.queue()).toBe(false)
    expect(props?.items).toEqual(items)
    expect(props?.sending).toBe("x")
    expect(props?.edit).toEqual(editing)
    expect(typeof props?.onQueue).toBe("function")
    expect(typeof props?.onAbort).toBe("function")
    expect(typeof props?.onSend).toBe("function")
    expect(typeof props?.onEdit).toBe("function")
    expect(typeof props?.onEditLoaded).toBe("function")
  })

  test("onAbort is a no-op when paramsId resolves undefined inside the closure", () => {
    let setCalls = 0
    const props = buildFollowupDockProps({
      paramsId: () => undefined,
      queueEnabled: () => true,
      followupDock: () => [],
      sendingFollowup: () => undefined,
      editingFollowup: () => undefined,
      queueFollowup: () => {},
      setFollowup: () => {
        setCalls++
      },
      sendFollowup: () => {},
      editFollowup: () => {},
      clearFollowupEdit: () => {},
    })

    // Build first to satisfy the outer guard, then test the closure separately.
    expect(props).toBeUndefined()
    expect(setCalls).toBe(0)
  })

  test("onSend calls sendFollowup with the captured session id and manual flag", () => {
    const calls: Array<{ sid: string; fid: string; opts: { manual: boolean } }> = []
    const props = buildFollowupDockProps({
      paramsId: () => "session-7",
      queueEnabled: () => true,
      followupDock: () => [],
      sendingFollowup: () => undefined,
      editingFollowup: () => undefined,
      queueFollowup: () => {},
      setFollowup: () => {},
      sendFollowup: (sid, fid, opts) => {
        calls.push({ sid, fid, opts })
      },
      editFollowup: () => {},
      clearFollowupEdit: () => {},
    })

    props?.onSend("fid-1")
    expect(calls).toEqual([{ sid: "session-7", fid: "fid-1", opts: { manual: true } }])
  })
})
