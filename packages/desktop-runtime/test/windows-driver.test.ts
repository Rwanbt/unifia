/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { powershellInvocation } from "../src/powershell.ts"
import { WindowsDesktopDriver } from "../src/windows-driver.ts"

describe("WindowsDesktopDriver command boundary", () => {
  test("the script is the last PowerShell argument: no caller values become code", () => {
    const script = 'param() Write-Output "x"'
    const argv = powershellInvocation(script)
    expect(argv.length).toBe(6)
    expect(argv.at(-1)).toBe(script)
  })

  test("observe and control preserve exact operations, targets and payloads", async () => {
    const calls: Array<{ operation: string; appId: string; windowId?: string; payload?: unknown }> = []
    const driver = new WindowsDesktopDriver(async (operation, target, payload) => {
      calls.push({ operation, appId: target.appId, windowId: target.windowId, payload })
      return operation === "observe" ? JSON.stringify({ appId: target.appId, windows: [] }) : ""
    })
    expect(await driver.observe({ appId: "notepad" })).toEqual({ appId: "notepad", windows: [] })
    await driver.control({ appId: "notepad", windowId: "Editor" }, "keyboard", { keys: "hello" })
    await driver.control({ appId: "notepad", windowId: "Editor" }, "mouse", { x: 1, y: 2, button: "left" })
    expect(calls).toEqual([
      { operation: "observe", appId: "notepad", windowId: undefined, payload: undefined },
      { operation: "keyboard", appId: "notepad", windowId: "Editor", payload: { keys: "hello" } },
      { operation: "mouse", appId: "notepad", windowId: "Editor", payload: { x: 1, y: 2, button: "left" } },
    ])
  })

  test("a driver failure propagates instead of appearing as a successful action", async () => {
    const driver = new WindowsDesktopDriver(async () => { throw new Error("target unavailable") })
    await expect(driver.control({ appId: "notepad" }, "keyboard", { keys: "hello" })).rejects.toThrow("target unavailable")
  })
})
