/* SPDX-License-Identifier: MIT */

import { base64Decode, base64Encode } from "@unifia/util/encode"
import { SHELL_MODES, type ShellMode } from "@unifia/workbench-shell/modes"

export type ModeLocation =
  | { kind: "home"; directory: ""; mode: undefined; sessionId?: undefined }
  | { kind: "workspace-root"; directory: string; mode: "code"; sessionId?: string }
  | { kind: "mode"; directory: string; mode: Exclude<ShellMode, "code">; sessionId?: string }
  | { kind: "settings"; directory: string; mode: "settings"; sessionId?: string }
  | { kind: "user"; directory: string; mode: "user"; sessionId?: string }
  | { kind: "browser"; directory: string; mode: "browser"; sessionId?: string }
  | { kind: "memory"; directory: string; mode: "memory"; sessionId?: string }
  | { kind: "invalid"; directory: string; mode: undefined; reason: "workspace" | "mode" | "session" }

export type WorkspaceDestination = ShellMode | "settings" | "user" | "browser" | "memory"

export type AutomateAccess = "unknown" | "allowed" | "denied"

export function routeDirectoryFromPathname(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? ""
}

export function sessionSearchFromLocation(search: string): string {
  const session = new URLSearchParams(search).get("session")
  return session ? `?session=${encodeURIComponent(session)}` : ""
}

export function parseModeLocation(pathname: string, search = "", _automateAccess: AutomateAccess | boolean = "denied"): ModeLocation {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return { kind: "home", directory: "", mode: undefined }

  let directory: string
  try {
    directory = base64Decode(segments[0]!)
  } catch {
    return { kind: "invalid", directory: "", mode: undefined, reason: "workspace" }
  }
  if (!directory) return { kind: "invalid", directory, mode: undefined, reason: "workspace" }
  if (segments.length === 1) return { kind: "workspace-root", directory, mode: "code" }

  const route = segments[1]
  if (route === "session") {
    if (segments.length > 3) return { kind: "invalid", directory, mode: undefined, reason: "session" }
    const pathSession = segments[2]
    const querySession = new URLSearchParams(search).get("session") ?? undefined
    if (pathSession && querySession && pathSession !== querySession) {
      return { kind: "invalid", directory, mode: undefined, reason: "session" }
    }
    return { kind: "workspace-root", directory, mode: "code", sessionId: pathSession ?? querySession }
  }
  // Keep Automate renderable without workflow.run. Capability enforcement
  // belongs to the Workbench operation/server boundary; rejecting the route
  // here produced a misleading invalid-mode screen before the surface could
  // explain that the bridge or capability was unavailable.
  if (route === "settings") {
    if (segments.length > 2) return { kind: "invalid", directory, mode: undefined, reason: "mode" }
    const session = new URLSearchParams(search).get("session") ?? undefined
    return { kind: "settings", directory, mode: "settings", sessionId: session }
  }
  if (route === "user") {
    if (segments.length > 2) return { kind: "invalid", directory, mode: undefined, reason: "mode" }
    const session = new URLSearchParams(search).get("session") ?? undefined
    return { kind: "user", directory, mode: "user", sessionId: session }
  }
  if (route === "browser" || route === "memory") {
    if (segments.length > 2) return { kind: "invalid", directory, mode: undefined, reason: "mode" }
    const session = new URLSearchParams(search).get("session") ?? undefined
    if (route === "browser") return { kind: "browser", directory, mode: "browser", sessionId: session }
    return { kind: "memory", directory, mode: "memory", sessionId: session }
  }
  if (!SHELL_MODES.includes(route as ShellMode) || route === "code" || segments.length > 2) {
    return { kind: "invalid", directory, mode: undefined, reason: "mode" }
  }

  const session = new URLSearchParams(search).get("session") ?? undefined
  return { kind: "mode", directory, mode: route as Exclude<ShellMode, "code">, sessionId: session }
}

export function modeHref(current: ModeLocation, targetMode: WorkspaceDestination): string | undefined {
  if (!current.directory || current.kind === "invalid" || current.kind === "home") return
  const directory = base64Encode(current.directory)
  if (targetMode === "code") {
    return `/${directory}/session${current.sessionId ? `/${encodeURIComponent(current.sessionId)}` : ""}`
  }
  const query = current.sessionId ? `?session=${encodeURIComponent(current.sessionId)}` : ""
  return `/${directory}/${targetMode}${query}`
}

/**
 * Where to move so the current location names `sessionId`, or `undefined` when
 * it must not move.
 *
 * WHY it is a function of its own rather than three lines inside the mode
 * context: this is the rule that keeps one conversation across a mode change.
 * Left inline it could only be exercised through a router, so the cases that
 * actually matter — a location that cannot carry a session, and a session
 * already named — would go unchecked.
 */
export function sessionAdoptionPath(current: ModeLocation, mode: ShellMode, sessionId: string): string | undefined {
  if (!sessionId) return
  if (current.kind === "invalid" || current.kind === "home") return
  if (current.sessionId === sessionId) return
  return modeNavigationPath(current.directory, mode, `?session=${encodeURIComponent(sessionId)}`)
}

export function destinationNavigationPath(
  directory: string,
  destination: WorkspaceDestination,
  sessionSearch: string,
): string | undefined {
  if (!directory) return
  if (destination === "code") return `/${base64Encode(directory)}/session${sessionSearch}`
  return `/${base64Encode(directory)}/${destination}${sessionSearch}`
}

export function resolveModeDirectory(routeDirectory: string | undefined): string {
  if (routeDirectory === undefined) return ""
  try {
    return base64Decode(routeDirectory)
  } catch {
    return ""
  }
}

export function modeNavigationPath(directory: string, mode: ShellMode, sessionSearch: string): string | undefined {
  if (!directory) return
  if (mode === "code") return `/${base64Encode(directory)}/session${sessionSearch}`
  return `/${base64Encode(directory)}/${mode}${sessionSearch}`
}
