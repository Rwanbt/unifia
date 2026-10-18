/* SPDX-License-Identifier: MIT */
export type DesktopTarget = { appId: string; windowId?: string }
/** Only a pre-driver policy refusal can prove that no desktop effect ran. */
export class DesktopPolicyRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DesktopPolicyRefusal"
  }
}
/** Driver exceptions are untrusted: an effect may already have happened. */
export class DesktopDriverFailure extends Error {
  constructor() {
    super("desktop driver failed")
    this.name = "DesktopDriverFailure"
  }
}
/** What an assisted observation saw. Shared by the safety guard (policy) and the desktop snapshot provider (driver side). */
export type WindowSnapshot = {
  appId: string
  windowId: string
  title: string
  focused: boolean
  /** Text visible in the window, from OCR or an accessibility tree. */
  visibleText: string
  /** Whether the element that would receive input is a secret entry field. */
  focusedFieldIsSecret: boolean
}
export class EmergencyStop {
  #stopped = false
  engage(): void { this.#stopped = true }
  reset(): void { this.#stopped = false }
  isStopped(): boolean { return this.#stopped }
}
export type DesktopDriver = { observe(target: DesktopTarget): Promise<unknown>; control(target: DesktopTarget, action: "keyboard" | "mouse", payload: unknown): Promise<void> }
/**
 * What a Computer Use surface exposes to the sidecar routes: observing a
 * target and controlling it. `DesktopAutomationBroker` is the raw
 * driver-side implementation; the guarded composition (observation receipts,
 * `GuardedDesktopBroker`) satisfies the same port, so the sidecar injects the
 * shape, never one class.
 */
export type DesktopAutomationPort = {
  observe(target: DesktopTarget): Promise<unknown>
  control(target: DesktopTarget, action: "keyboard" | "mouse", payload: unknown): Promise<void>
}
export class DesktopAutomationBroker implements DesktopAutomationPort {
  readonly #driver: DesktopDriver
  readonly #allowedApps: readonly string[]
  readonly #stop: EmergencyStop
  readonly #switches: { isEngaged(surface: "computer-use"): boolean }
  constructor(driver: DesktopDriver, allowedApps: readonly string[], switches: { isEngaged(surface: "computer-use"): boolean } = { isEngaged: () => false }, stop: EmergencyStop = new EmergencyStop()) { this.#driver = driver; this.#allowedApps = allowedApps; this.#switches = switches; this.#stop = stop }
  #check(target: DesktopTarget): void { if (this.#stop.isStopped()) throw new DesktopPolicyRefusal("emergency stop is engaged"); if (!this.#allowedApps.includes(target.appId)) throw new DesktopPolicyRefusal("desktop app is not allowlisted"); if (this.#switches.isEngaged("computer-use")) throw new DesktopPolicyRefusal("computer use is disabled") }
  async observe(target: DesktopTarget): Promise<unknown> {
    this.#check(target)
    try {
      return await this.#driver.observe({ ...target })
    } catch {
      // Even a driver-thrown DesktopPolicyRefusal cannot claim zero effects.
      throw new DesktopDriverFailure()
    }
  }
  async control(target: DesktopTarget, action: "keyboard" | "mouse", payload: unknown): Promise<void> {
    this.#check(target)
    try {
      await this.#driver.control({ ...target }, action, payload)
    } catch {
      throw new DesktopDriverFailure()
    }
  }
}
