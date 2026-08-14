/* SPDX-License-Identifier: MIT */

import { base64Decode } from "@unifia/util/encode"

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
