/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { powershellInvocation } from "../src/powershell.ts"
import { WindowsDesktopDriver } from "../src/windows-driver.ts"

// WHY these assertions: with `-Command`, Windows PowerShell appends any
// trailing argv to the command text and parses it as code — a physical
// Windows 11 run on 2026-10-18 showed a bare `notepad` token launching the app
// and a JSON payload (`{"keys":"Hello"}`) failing with UnexpectedToken. The
// script must therefore be the last, verbatim argument; caller values travel
// via `$env:UNIFIA_PS_*`.
const argv = powershellInvocation('param() Write-Output "x"')
assert.equal(argv.length, 6, "no trailing argv: -Command parses it as command text")
assert.equal(argv.at(-1), 'param() Write-Output "x"', "the script must be the last argument, verbatim")

const calls: Array<{ operation: string; appId: string; payload?: unknown }> = []
const driver = new WindowsDesktopDriver(async (operation, target, payload) => { calls.push({ operation, appId: target.appId, payload }); return operation === "observe" ? JSON.stringify({ appId: target.appId, windows: [] }) : "" })
const observed = await driver.observe({ appId: "notepad" }) as { appId: string }
assert.equal(observed.appId, "notepad")
await driver.control({ appId: "notepad", windowId: "Editor" }, "keyboard", { keys: "hello" })
await driver.control({ appId: "notepad", windowId: "Editor" }, "mouse", { x: 1, y: 2, button: "left" })
assert.deepEqual(calls.map((call) => call.operation), ["observe", "keyboard", "mouse"])
console.log("WindowsDesktopDriver: 5/5 passed")
