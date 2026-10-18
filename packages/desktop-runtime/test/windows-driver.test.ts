/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { powershellInvocation } from "../src/powershell.ts"
import { WindowsDesktopDriver } from "../src/windows-driver.ts"

// WHY these assertions: with `-Command "<script with param()>" args`, Windows
// PowerShell executes the trailing argv instead of passing it to param() —
// measured on a physical Windows 11 run on 2026-10-18, where the snapshot
// command failed and the bare `notepad` token launched the app. The `& { ... }`
// wrapper is what makes the argv reach the script.
const argv = powershellInvocation('param([string]$a,[string]$b) Write-Output "A=$a B=$b"', ["notepad", "42"])
const command = argv[argv.indexOf("-Command") + 1]
assert.ok(command?.startsWith("& { ") && command?.endsWith(" }"), "the script must be invoked as a scriptblock")
assert.deepEqual(argv.slice(-2), ["notepad", "42"], "the trailing argv must stay separate arguments")

const calls: Array<{ operation: string; appId: string; payload?: unknown }> = []
const driver = new WindowsDesktopDriver(async (operation, target, payload) => { calls.push({ operation, appId: target.appId, payload }); return operation === "observe" ? JSON.stringify({ appId: target.appId, windows: [] }) : "" })
const observed = await driver.observe({ appId: "notepad" }) as { appId: string }
assert.equal(observed.appId, "notepad")
await driver.control({ appId: "notepad", windowId: "Editor" }, "keyboard", { keys: "hello" })
await driver.control({ appId: "notepad", windowId: "Editor" }, "mouse", { x: 1, y: 2, button: "left" })
assert.deepEqual(calls.map((call) => call.operation), ["observe", "keyboard", "mouse"])
console.log("WindowsDesktopDriver: 5/5 passed")
