/* SPDX-License-Identifier: MIT */
import { DesktopAutomationBroker, EmergencyStop } from "@unifia/contracts"
import { WindowsDesktopDriver } from "@unifia/desktop-runtime"

/**
 * The distributed sidecar's Computer Use surface (owner decision 8B: Computer
 * Use is REQUIRED for RC-1). The full chain is: the capability gate and the
 * audited refusals on the route (workbench-server `handlers/automation.ts`),
 * the broker's allowlist, emergency stop and kill switch here, then the real
 * Windows driver.
 *
 * WHY the surface only exists when an operator allowlists applications: the
 * sidecar must never reach the host implicitly. A missing allowlist — or any
 * non-Windows platform — keeps the `/v1/desktop/*` routes fail-closed with
 * 503, exactly as before this composition, and no driver is ever constructed.
 *
 * Real OS effects remain opt-in and physically unqualified: receipts/consent
 * hardening (computer-use-safety) and the platform qualification matrix stay
 * tracked by #571.
 */
export const desktopEmergencyStop = new EmergencyStop()

export function desktopSurfaceFromEnv(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  stop: EmergencyStop = desktopEmergencyStop,
): DesktopAutomationBroker | undefined {
  if (platform !== "win32") return undefined
  const allowed = (env.UNIFIA_DESKTOP_ALLOWED_APPS ?? "")
    .split(",")
    .map((app) => app.trim())
    .filter(Boolean)
  if (allowed.length === 0) return undefined
  return new DesktopAutomationBroker(
    new WindowsDesktopDriver(),
    allowed,
    { isEngaged: () => env.UNIFIA_COMPUTER_USE_DISABLED === "1" },
    stop,
  )
}
