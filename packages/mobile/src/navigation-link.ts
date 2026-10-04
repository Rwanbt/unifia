/* SPDX-License-Identifier: MIT */

import { parseDeepLink } from "../../app/src/pages/layout/deep-links"
import { trimTrailingSlashes } from "../../app/src/utils/url"

export type MobileNavigationLink =
  | { kind: "open"; directory: string; file?: string }
  | { kind: "session"; sessionID: string }

export function parseMobileNavigationLink(raw: string): MobileNavigationLink | undefined {
  let url: URL
  try { url = new URL(raw) } catch { return }
  if (url.protocol !== "unifia:") return
  const command = url.hostname || url.pathname.replace(/^\/+/, "")
  if (command === "session") {
    const id = url.searchParams.get("id")
    if (id && /^[a-zA-Z0-9_-]{1,256}$/.test(id)) return { kind: "session", sessionID: id }
    return
  }
  if (command !== "open") return
  const project = url.searchParams.get("project")
  if (!project) return
  const directory = parseDeepLink(`unifia://open-project?directory=${encodeURIComponent(project)}`)
  if (!directory) return
  const file = url.searchParams.get("file") || undefined
  if (!file) return { kind: "open", directory }
  const normalized = file.replaceAll("\\", "/")
  const root = trimTrailingSlashes(directory.replaceAll("\\", "/"))
  if (file.length > 4096 || /[\0\r\n]/.test(file) || normalized.split("/").includes("..")) return
  const absolute = normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)
  if (absolute && !normalized.startsWith(`${root}/`)) return
  if (!absolute && /^[a-z][a-z0-9+.-]*:/i.test(file)) return
  return { kind: "open", directory, file: absolute ? file : `${directory}/${file}` }
}
