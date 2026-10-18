/* SPDX-License-Identifier: MIT */

/**
 * PowerShell invocation shape shared by the desktop driver and the snapshot
 * provider.
 *
 * WHY the `& { ... }` wrapper: with `-Command "<script with param()>" a b`,
 * Windows PowerShell parses the trailing argv as statements of the command
 * string — the script's `param()` block stays empty and the values are
 * executed instead. A physical Windows 11 run on 2026-10-18 reproduced it:
 * the snapshot command failed and the bare `notepad` token launched the app.
 * Invoking the scriptblock explicitly — `& { <script> } a b` — passes the
 * trailing argv to the param block.
 */
export function powershellInvocation(script: string, args: readonly string[]): string[] {
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-Command", `& { ${script} }`, ...args]
}
