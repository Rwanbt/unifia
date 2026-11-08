/* SPDX-License-Identifier: MIT */

import { WorkbenchHttpError } from "@unifia/workbench-shell"
import { WebWorkbenchBridgeUnavailableError } from "@/context/workbench/web-bridge"

type Translate = (key: string, params?: Record<string, string>) => string

const NATIVE_LEASE_REFUSED = "capability not allowed at connection"

/**
 * A localized message for a Browser failure the user can act on, which a retry
 * cannot fix; undefined otherwise. Tauri rejects an invoke with a bare string,
 * so the native lease refusal is matched on text, not on an Error class.
 */
export function describeBrowserFailure(reason: unknown, t: Translate): string | undefined {
  if (reason instanceof WebWorkbenchBridgeUnavailableError) return t("workbench.errors.webBridgeNeedsPassword")
  const text = reason instanceof Error ? reason.message : String(reason)
  if (text.includes(NATIVE_LEASE_REFUSED)) return t("browser.surface.leaseRefused", { detail: text })
  if (!(reason instanceof WorkbenchHttpError)) return undefined
  // The isolated browser could not be installed: "try again" cannot help.
  if (reason.code === "BROWSER_HOST_UNAVAILABLE") return t("browser.surface.hostUnavailable")
  if (reason.status === 401 || reason.status === 403) return t("browser.surface.accessDenied")
  return undefined
}
