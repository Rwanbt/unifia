/* SPDX-License-Identifier: MIT */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { DesktopTarget, WindowSnapshot } from "@unifia/contracts"

const execFileAsync = promisify(execFile)

/**
 * Bounds for the accessibility walk.
 *
 * The accessibility tree has no natural size: a browser window can hold
 * thousands of nodes. A snapshot that walks it without limits hangs the
 * automation loop instead of refusing it, so the walk is bounded by depth and
 * by element count, and the text that leaves the machine is bounded by length.
 * The values are interpolated into the script below so each limit has exactly
 * one owner.
 */
export const SNAPSHOT_BOUNDS = { maxDepth: 4, maxElements: 400, maxVisibleTextChars: 8_000 } as const

export type WindowSnapshotProvider = { snapshot(target: DesktopTarget): Promise<WindowSnapshot> }

/**
 * A snapshot could not be taken.
 *
 * Callers must treat this as a refusal — never as an empty screen, and never
 * retry by inventing identical content, because a guard acting on a fabricated
 * observation is exactly the failure the receipts exist to prevent.
 */
export class WindowSnapshotUnavailable extends Error {
  readonly appId: string
  constructor(appId: string, detail: string, options?: { cause?: unknown }) {
    super(`window snapshot unavailable for ${appId}: ${detail}`, options)
    this.name = "WindowSnapshotUnavailable"
    this.appId = appId
  }
}

const WINDOWS_SNAPSHOT_SCRIPT = `param([string]$appId,[string]$windowId)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$windows = @(Get-Process -Name $appId -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($windowId) {
  $windows = @($windows | Where-Object { "$($_.Id)" -eq $windowId -or $_.MainWindowTitle -eq $windowId })
}
if ($windows.Count -eq 0) { throw "no window for app: $appId" }
$window = $windows[0]
$handle = [int64]$window.MainWindowHandle
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)
if ($null -eq $root) { throw "accessibility root unavailable for app: $appId" }
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$texts = New-Object System.Collections.Generic.List[string]
$budget = @{ elements = 0 }
function Walk([System.Windows.Automation.AutomationElement]$element, [int]$depth) {
  if ($null -eq $element -or $depth -gt ${SNAPSHOT_BOUNDS.maxDepth} -or $budget.elements -ge ${SNAPSHOT_BOUNDS.maxElements}) { return }
  $budget.elements += 1
  if (-not $element.Current.IsPassword) {
    $name = $element.Current.Name
    if ($name) { [void]$texts.Add([string]$name) }
  }
  $child = $walker.GetFirstChild($element)
  while ($null -ne $child) {
    Walk $child ($depth + 1)
    $child = $walker.GetNextSibling($child)
  }
}
Walk $root 0
$secret = $true
try {
  $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -ne $focusedElement) { $secret = [bool]$focusedElement.Current.IsPassword } else { $secret = $false }
} catch { $secret = $true }
$text = ($texts -join [char]10)
if ($text.Length -gt ${SNAPSHOT_BOUNDS.maxVisibleTextChars}) { $text = $text.Substring(0, ${SNAPSHOT_BOUNDS.maxVisibleTextChars}) }
@{ windowId = "$($window.Id)"; title = [string]$window.MainWindowTitle; focused = ([int64]([NativeForeground]::GetForegroundWindow()) -eq $handle); visibleText = $text; focusedFieldIsSecret = $secret } | ConvertTo-Json -Compress`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseSnapshot(appId: string, raw: string): WindowSnapshot {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new WindowSnapshotUnavailable(appId, "the provider returned malformed JSON")
  }
  if (!isRecord(payload)) throw new WindowSnapshotUnavailable(appId, "the provider returned a non-object payload")
  const { windowId, title, focused, visibleText, focusedFieldIsSecret } = payload
  if (
    typeof windowId !== "string" ||
    typeof title !== "string" ||
    typeof focused !== "boolean" ||
    typeof visibleText !== "string" ||
    typeof focusedFieldIsSecret !== "boolean"
  ) {
    throw new WindowSnapshotUnavailable(appId, "the provider returned an incomplete snapshot")
  }
  // WHY the second clamp here: the script bounds the text it emits, and this
  // bounds whatever a future provider implementation emits. The guard reads
  // visibleText for injection patterns, so its size must not be provider-defined.
  return {
    appId,
    windowId,
    title,
    focused,
    visibleText: visibleText.slice(0, SNAPSHOT_BOUNDS.maxVisibleTextChars),
    focusedFieldIsSecret,
  }
}

type CommandRunner = (target: DesktopTarget) => Promise<string>

/**
 * Windows window snapshots: title, foreground state and visible text read
 * through the UI Automation tree, plus whether the focused element is a
 * password box.
 *
 * The runner is injectable so the parsing, refusal and clamping logic is
 * testable without a real window. The real UI Automation read is not certified
 * by CI — it needs a physical Windows session (PHYSICAL_TEST_REQUIRED).
 */
export class WindowsSnapshotProvider implements WindowSnapshotProvider {
  readonly #run: CommandRunner
  constructor(run: CommandRunner = WindowsSnapshotProvider.#runPowerShell) {
    this.#run = run
  }

  async snapshot(target: DesktopTarget): Promise<WindowSnapshot> {
    let raw: string
    try {
      raw = await this.#run({ ...target })
    } catch (error) {
      const detail = error instanceof Error ? error.message.trim().slice(0, 300) : String(error)
      throw new WindowSnapshotUnavailable(target.appId, `the provider command failed: ${detail}`, { cause: error })
    }
    return parseSnapshot(target.appId, raw)
  }

  static async #runPowerShell(target: DesktopTarget): Promise<string> {
    const result = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-Command", WINDOWS_SNAPSHOT_SCRIPT, target.appId, target.windowId ?? ""],
      { timeout: 15_000, windowsHide: true, maxBuffer: 1_000_000 },
    )
    return result.stdout.trim()
  }
}
