/* SPDX-License-Identifier: MIT */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { DesktopAutomationBroker, type DesktopDriver, type DesktopTarget } from "@unifia/contracts"
import { powershellInvocation } from "./powershell.js"

const execFileAsync = promisify(execFile)
const WINDOWS_SCRIPT = `$operation = $env:UNIFIA_PS_OPERATION
$appId = $env:UNIFIA_PS_APP
$windowId = $env:UNIFIA_PS_WINDOW
$payload = $env:UNIFIA_PS_PAYLOAD
$ErrorActionPreference = "Stop"
if ($operation -eq "observe") {
  $processes = @(Get-Process -Name $appId -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle,MainWindowHandle)
  @{ appId = $appId; windows = $processes } | ConvertTo-Json -Compress
  exit 0
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
$data = $payload | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
# WHY the activation must succeed: input goes to whatever holds the
# foreground, so a silent failure would type into the wrong window.
$activate = if ($windowId) { $windowId } else { $appId }
$pidValue = 0
if ([int]::TryParse($activate, [ref]$pidValue)) { $activate = $pidValue }
if (-not $shell.AppActivate($activate)) { throw "could not activate the target window" }
if ($operation -eq "keyboard") { $shell.SendKeys([string]$data.keys); exit 0 }
if ($operation -eq "mouse") {
  [void][NativeInput]::SetCursorPos([int]$data.x, [int]$data.y)
  if ($data.button -eq "left") { [NativeInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [NativeInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
  elseif ($data.button -eq "right") { [NativeInput]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero); [NativeInput]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero) }
  else { throw "unsupported mouse button" }
  exit 0
}
throw "unsupported desktop operation"`

type CommandRunner = (operation: string, target: DesktopTarget, payload?: unknown) => Promise<string>
export class WindowsDesktopDriver implements DesktopDriver {
  readonly #run: CommandRunner
  constructor(run: CommandRunner = WindowsDesktopDriver.#runPowerShell) { this.#run = run }
  async observe(target: DesktopTarget): Promise<unknown> { return JSON.parse(await this.#run("observe", target)) }
  async control(target: DesktopTarget, action: "keyboard" | "mouse", payload: unknown): Promise<void> { await this.#run(action, target, payload) }
  static async #runPowerShell(operation: string, target: DesktopTarget, payload?: unknown): Promise<string> {
    const result = await execFileAsync("powershell.exe", powershellInvocation(WINDOWS_SCRIPT), {
      env: {
        ...process.env,
        UNIFIA_PS_OPERATION: operation,
        UNIFIA_PS_APP: target.appId,
        UNIFIA_PS_WINDOW: target.windowId ?? "",
        UNIFIA_PS_PAYLOAD: JSON.stringify(payload ?? {}),
      },
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1_000_000,
    })
    return result.stdout.trim()
  }
}

export function createWindowsDesktopBroker(allowedApps: readonly string[], switches?: { isEngaged(surface: "computer-use"): boolean }): DesktopAutomationBroker {
  return new DesktopAutomationBroker(new WindowsDesktopDriver(), allowedApps, switches)
}