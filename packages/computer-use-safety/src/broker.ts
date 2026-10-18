/* SPDX-License-Identifier: MIT */

/**
 * Guarded desktop broker — the composition that makes observation receipts
 * binding on the distributed Computer Use surface (#571, decision 8B).
 *
 * `DesktopAutomationBroker` refuses a non-allowlisted app, an engaged
 * emergency stop and a disengaged kill switch, but it knows nothing about
 * *what was on screen*. The guard knows exactly that, but the sidecar routes
 * never called it. This wrapper joins the two: observing a window mints a
 * receipt from a fresh snapshot, and controlling it presents that receipt
 * against the screen as it is now. No receipt — no act.
 */

import { ComputerUseRefused, type ComputerUseGuard, type ObservationReceipt } from "./index.js"
import type { DesktopAutomationPort, DesktopTarget, WindowSnapshot } from "@unifia/contracts"

/** Structural port of `WindowsSnapshotProvider`: @unifia/desktop-runtime implements it. */
export type WindowSnapshotProviderLike = { snapshot(target: DesktopTarget): Promise<WindowSnapshot> }

export class GuardedDesktopBroker implements DesktopAutomationPort {
  readonly #inner: DesktopAutomationPort
  readonly #guard: ComputerUseGuard
  readonly #provider: WindowSnapshotProviderLike
  readonly #receipts = new Map<string, ObservationReceipt>()

  constructor(inner: DesktopAutomationPort, guard: ComputerUseGuard, provider: WindowSnapshotProviderLike) {
    this.#inner = inner
    this.#guard = guard
    this.#provider = provider
  }

  /** Observes through the broker, then mints the receipt an act must present. */
  async observe(target: DesktopTarget): Promise<unknown> {
    const observation = await this.#inner.observe(target)
    const receipt = this.#guard.observe(await this.#provider.snapshot(target))
    // Last observation wins for a target: an old receipt must not outlive the
    // screen it described.
    this.#receipts.set(key(target), receipt)
    return observation
  }

  /**
   * Acts only on a receipt minted by a prior observation of the same target.
   *
   * WHY the refusal when no receipt exists: an act on a window nobody observed
   * is exactly the unguarded path the receipts exist to close. The vocabulary
   * matches the guard's unknown-receipt refusal, and neither the driver nor
   * the snapshot provider is contacted.
   */
  async control(target: DesktopTarget, action: "keyboard" | "mouse", payload: unknown): Promise<void> {
    const receipt = this.#receipts.get(key(target))
    if (!receipt) throw new ComputerUseRefused({ reason: "receipt-expired", ageMs: -1 })
    const current = await this.#provider.snapshot(target)
    this.#guard.authorize(receipt.id, current, action)
    // One observation authorises one act: consuming before the driver runs
    // means two concurrent controls cannot both pass on the same receipt.
    this.#guard.consume(receipt.id)
    this.#receipts.delete(key(target))
    await this.#inner.control(target, action, payload)
  }
}

function key(target: DesktopTarget): string {
  return `${target.appId}::${target.windowId ?? ""}`
}
