/* SPDX-License-Identifier: MIT */

import { base64Decode, base64Encode } from "@unifia/util/encode"
import type { ShellMode } from "@unifia/workbench-shell/modes"

export function routeDirectoryFromPathname(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? ""
}

export function sessionSearchFromLocation(search: string): string {
  const session = new URLSearchParams(search).get("session")
  return session ? `?session=${encodeURIComponent(session)}` : ""
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
