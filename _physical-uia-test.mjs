/* SPDX-License-Identifier: MIT */
// Physical UIA test for #571 — real Windows observation + control through the
// guarded distributed chain. Safe target: a scratch Notepad window (pid given
// below) holding a throwaway temp file. Run from the rc1-548-deferred-contract
// worktree (node_modules at dev):
//   bun C:\Users\barat\AppData\Local\Temp\opencode\rc1\physical-uia-test.mjs <pid>
import { execFileSync } from "node:child_process"
import { DesktopAutomationBroker, EmergencyStop } from "@unifia/contracts"
import { ComputerUseGuard, GuardedDesktopBroker } from "@unifia/computer-use-safety"
import { WindowsDesktopDriver, WindowsSnapshotProvider } from "@unifia/desktop-runtime"

const pid = process.argv[2] ?? "28732"
const target = { appId: "notepad", windowId: pid }
const allowed = ["notepad"]
const stop = new EmergencyStop()
const provider = new WindowsSnapshotProvider()

// Bring the scratch window to the foreground: the guard's focus check reads the
// foreground window, and the driver only activates as part of `control`.
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `(New-Object -ComObject WScript.Shell).AppActivate(${pid}) | Out-Null; Start-Sleep -Milliseconds 900`,
])

const snap = async (label) => {
  const s = await provider.snapshot(target)
  console.log(`${label}: title="${s.title}" focused=${s.focused} textChars=${s.visibleText.length} secret=${s.focusedFieldIsSecret}`)
  return s
}

console.log(`=== PHYSICAL UIA TEST (#571) — target: notepad pid ${pid} only ===`)
const before = await snap("BEFORE")

const broker = new DesktopAutomationBroker(new WindowsDesktopDriver(), allowed, { isEngaged: () => false }, stop)
const guard = new ComputerUseGuard({ allowedApps: allowed, stop })
const guarded = new GuardedDesktopBroker(broker, guard, provider)

// 1) No observation -> the guarded chain must refuse before any driver contact.
try {
  await guarded.control(target, "keyboard", { keys: "x" })
  console.log("UNGUARDED: ALLOWED (BAD)")
} catch (error) {
  console.log(`UNGUARDED REFUSED: ${error.name}:${error.refusal?.reason}`)
}

// 2) Observe (mints a receipt from a fresh snapshot) then control through it.
const observed = await guarded.observe(target)
console.log(`OBSERVED: ${JSON.stringify(observed).slice(0, 160)}`)
await guarded.control(target, "keyboard", { keys: "Hello from the physical UIA test! " })
console.log("TYPED: keyboard payload delivered through the guarded chain")

// 3) A second control must be refused (one observation = one act).
try {
  await guarded.control(target, "keyboard", { keys: "again" })
  console.log("REPLAY: ALLOWED (BAD)")
} catch (error) {
  console.log(`REPLAY REFUSED: ${error.name}:${error.refusal?.reason}`)
}

// 4) Re-snapshot: Notepad marks a modified document with a leading '*'.
const after = await snap("AFTER")
console.log(`EFFECT: title changed = ${before.title !== after.title}`)
console.log("=== PHYSICAL UIA TEST DONE ===")
