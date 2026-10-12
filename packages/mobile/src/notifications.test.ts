/* SPDX-License-Identifier: MIT */

import { afterEach, expect, mock, test } from "bun:test"
import type { SSEEvent } from "./notifications"

const send = mock(() => {})
let permission: Promise<boolean> = Promise.resolve(true)
mock.module("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => permission,
  requestPermission: async () => "granted",
  sendNotification: send,
}))
const { NotificationBridge } = await import("./notifications")
const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState")
afterEach(() => {
  send.mockClear()
  permission = Promise.resolve(true)
  if (visibility) Object.defineProperty(document, "visibilityState", visibility)
  else Reflect.deleteProperty(document, "visibilityState")
})

test("NotificationBridge_TargetSwitch_UnsubscribesOldTarget", async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
  let oldHandler: ((event: SSEEvent) => void) | undefined
  let newHandler: ((event: SSEEvent) => void) | undefined
  let closed = false
  const local = new NotificationBridge((handler) => {
    oldHandler = handler
    return () => { closed = true }
  })
  await local.connect()
  local.disconnect()
  const remote = new NotificationBridge((handler) => {
    newHandler = handler
    return () => {}
  })
  await remote.connect()
  const event = { type: "session.updated", properties: { status: "completed", title: "Remote task" } }
  oldHandler?.(event)
  expect(closed).toBe(true)
  expect(send).not.toHaveBeenCalled()
  newHandler?.(event)
  expect(send).toHaveBeenCalledWith({ title: "Task Complete", body: "Remote task" })
  remote.disconnect()
})

test("NotificationBridge_DisposeDuringPermission_DoesNotSubscribe", async () => {
  let resolve: ((value: boolean) => void) | undefined
  permission = new Promise((done) => { resolve = done })
  const subscribe = mock(() => () => {})
  const bridge = new NotificationBridge(subscribe)
  const connecting = bridge.connect()
  bridge.disconnect()
  resolve?.(true)
  await connecting
  expect(subscribe).not.toHaveBeenCalled()
})
