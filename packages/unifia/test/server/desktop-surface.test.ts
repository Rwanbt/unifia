/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { EmergencyStop } from "@unifia/contracts"
import { ComputerUseRefused } from "@unifia/computer-use-safety"
import { desktopSurfaceFromEnv } from "../../src/server/desktop-surface"

// REFUSALS ONLY. Every case below throws before the driver or the snapshot
// provider runs: no PowerShell is spawned and no keyboard or mouse input can
// be produced by this suite. The real Windows effects stay PHYSICAL_TEST_REQUIRED.
describe("desktop surface composition (decision 8B, opt-in)", () => {
  test("a missing or empty allowlist keeps the surface absent: the routes stay fail-closed", () => {
    expect(desktopSurfaceFromEnv({}, "win32")).toBeUndefined()
    expect(desktopSurfaceFromEnv({ UNIFIA_DESKTOP_ALLOWED_APPS: " , ," }, "win32")).toBeUndefined()
  })

  test("only Windows can produce a surface", () => {
    expect(desktopSurfaceFromEnv({ UNIFIA_DESKTOP_ALLOWED_APPS: "notepad" }, "linux")).toBeUndefined()
    expect(desktopSurfaceFromEnv({ UNIFIA_DESKTOP_ALLOWED_APPS: "notepad" }, "darwin")).toBeUndefined()
  })

  test("an app outside the allowlist is refused before any driver call", async () => {
    const surface = desktopSurfaceFromEnv({ UNIFIA_DESKTOP_ALLOWED_APPS: "notepad, calc" }, "win32", new EmergencyStop())
    if (!surface) throw new Error("surface must exist for an allowlisted Windows configuration")
    await expect(surface.observe({ appId: "other" })).rejects.toThrow("desktop app is not allowlisted")
  })

  test("the kill switch refuses without touching the driver", async () => {
    const surface = desktopSurfaceFromEnv(
      { UNIFIA_DESKTOP_ALLOWED_APPS: "notepad", UNIFIA_COMPUTER_USE_DISABLED: "1" },
      "win32",
      new EmergencyStop(),
    )
    if (!surface) throw new Error("surface must exist even when the kill switch is engaged")
    await expect(surface.observe({ appId: "notepad" })).rejects.toThrow("computer use is disabled")
  })

  test("an engaged emergency stop refuses observation too", async () => {
    const stop = new EmergencyStop()
    const surface = desktopSurfaceFromEnv({ UNIFIA_DESKTOP_ALLOWED_APPS: "notepad" }, "win32", stop)
    if (!surface) throw new Error("surface must exist")
    stop.engage()
    await expect(surface.observe({ appId: "notepad" })).rejects.toThrow("emergency stop is engaged")
  })

  test("control without an observation receipt is refused before any driver or provider call", async () => {
    const surface = desktopSurfaceFromEnv({ UNIFIA_DESKTOP_ALLOWED_APPS: "notepad" }, "win32", new EmergencyStop())
    if (!surface) throw new Error("surface must exist")
    const refusal = await surface.control({ appId: "notepad" }, "keyboard", { keys: "x" }).then(
      () => undefined,
      (error: unknown) => error,
    )
    if (!(refusal instanceof ComputerUseRefused)) throw new Error(`expected a ComputerUseRefused, got ${String(refusal)}`)
    expect(refusal.refusal.reason).toBe("receipt-expired")
  })

  test("the distributed entry composes the surface this module builds", () => {
    const source = readFileSync(path.join(import.meta.dir, "..", "..", "src", "server", "workbench.ts"), "utf8")
    expect(source).toContain('import { desktopSurfaceFromEnv } from "./desktop-surface"')
    expect(source).toContain("desktop: desktopSurfaceFromEnv(),")
  })
})
