/* SPDX-License-Identifier: MIT */
import { DesktopAutomationBroker, EmergencyStop, type DesktopAutomationPort } from "@unifia/contracts"
import { ComputerUseGuard, GuardedDesktopBroker } from "@unifia/computer-use-safety"
import { WindowsDesktopDriver, WindowsSnapshotProvider } from "@unifia/desktop-runtime"

/**
 * The distributed sidecar's Computer Use surface (owner decision 8B: Computer
 * Use is REQUIRED for RC-1). The full chain is: the capability gate and the
 * audited refusals on the route (workbench-server `handlers/automation.ts`),
 * the broker's allowlist, emergency stop and kill switch, the observation
 * receipts (computer-use-safety) and the real Windows driver and snapshot
 * provider (desktop-runtime).
 *
 * WHY the surface only exists when an operator allowlists applications: the
 * sidecar must never reach the host implicitly. A missing allowlist — or any
 * non-Windows platform — keeps the `/v1/desktop/*` routes fail-closed with
 * 503, exactly as before this composition, and no driver is ever constructed.
 *
 * WHY every action needs a receipt: observing a window mints one from a fresh
 * snapshot, and controlling it re-checks the screen as it is now, so a swapped
 * window, a lost focus, a secret field or an injected instruction refuses the
 * act before the driver runs. Real OS effects remain opt-in and physically
 * unqualified: the UI Automation physical test and the Linux/Android driver
 * matrix stay tracked by #571 (NO-GO).
 */
export const desktopEmergencyStop = new EmergencyStop()

export function desktopSurfaceFromEnv(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  stop: EmergencyStop = desktopEmergencyStop,
): DesktopAutomationPort | undefined {
  if (platform !== "win32") return undefined
  const allowed = (env.UNIFIA_DESKTOP_ALLOWED_APPS ?? "")
    .split(",")
    .map((app) => app.trim())
    .filter(Boolean)
  if (allowed.length === 0) return undefined
  const broker = new DesktopAutomationBroker(
    new WindowsDesktopDriver(),
    allowed,
    { isEngaged: () => env.UNIFIA_COMPUTER_USE_DISABLED === "1" },
    stop,
  )
  // One allowlist and one stop instance for both layers: the broker guards the
  // driver, the guard guards the receipts, and neither can drift from the other.
  const guard = new ComputerUseGuard({ allowedApps: allowed, stop })
  return new GuardedDesktopBroker(broker, guard, new WindowsSnapshotProvider())
}
