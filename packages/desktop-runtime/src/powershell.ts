/* SPDX-License-Identifier: MIT */

/**
 * PowerShell invocation shared by the desktop driver and the snapshot
 * provider.
 *
 * WHY the values travel via `$env:UNIFIA_PS_*` and never as trailing argv:
 * with `-Command`, Windows PowerShell appends the remaining argv to the
 * command text and parses it as code — simple words survive, a JSON payload
 * does not. A physical run on Windows 11 (2026-10-18) reproduced it twice:
 * `{"keys":"Hello"}` raised `UnexpectedToken` and the control failed with no
 * effect, and before that a bare `notepad` token launched the app. Environment
 * variables are read verbatim, so no caller value is ever parsed as code.
 */
export function powershellInvocation(script: string): string[] {
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-Command", script]
}
