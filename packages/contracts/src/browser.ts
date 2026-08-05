/* SPDX-License-Identifier: MIT */

/**
 * Selectors masked in every screenshot unless the caller replaces the list.
 *
 * Gate B's NO-GO list includes « screenshot complet non redacted par défaut ».
 * The default used to be the empty list, so a broker built without arguments
 * produced a full-fidelity screenshot of whatever was on screen — including a
 * password box mid-typing. Defaulting to a redaction baseline makes the unsafe
 * configuration the one someone has to ask for.
 */
export const DEFAULT_REDACT_SELECTORS: readonly string[] = [
  "input[type=password]",
  "input[autocomplete*='cc-']",
  "input[autocomplete='one-time-code']",
  "input[name*='otp' i]",
  "input[name*='secret' i]",
  "input[name*='token' i]",
  "[data-sensitive]",
]

export type BrowserAction = { kind: "navigate" | "snapshot" | "screenshot" | "download"; url?: string; filename?: string }
export type BrowserProfile = { workspaceId: string; profileId: string; hostAllowlist: readonly string[]; cookiesIsolated: true; redactSelectors: readonly string[] }
export type BrowserDriver = { navigate(profile: BrowserProfile, url: string): Promise<void>; snapshot(profile: BrowserProfile): Promise<unknown>; screenshot(profile: BrowserProfile): Promise<Uint8Array>; quarantineDownload(profile: BrowserProfile, filename: string, bytes: Uint8Array): Promise<string> }
export class BrowserAutomationBroker {
  readonly #driver: BrowserDriver
  readonly #profiles = new Map<string, BrowserProfile>()
  readonly #allowedHosts: readonly string[]
  readonly #redactSelectors: readonly string[]
  readonly #switches: { isEngaged(surface: "browser"): boolean }
  constructor(driver: BrowserDriver, allowedHosts: readonly string[], redactSelectors: readonly string[] = DEFAULT_REDACT_SELECTORS, switches: { isEngaged(surface: "browser"): boolean } = { isEngaged: () => false }) { this.#driver = driver; this.#allowedHosts = allowedHosts.map((host) => host.toLowerCase()); this.#redactSelectors = redactSelectors; this.#switches = switches }
  profile(workspaceId: string): BrowserProfile { const existing = this.#profiles.get(workspaceId); if (existing) return existing; const profile = { workspaceId, profileId: `browser-${workspaceId}`, hostAllowlist: this.#allowedHosts, cookiesIsolated: true as const, redactSelectors: this.#redactSelectors }; this.#profiles.set(workspaceId, profile); return profile }
  async navigate(workspaceId: string, url: string): Promise<void> { if (this.#switches.isEngaged("browser")) throw new Error("browser is disabled"); const parsed = new URL(url); if (!this.#allowedHosts.includes(parsed.host.toLowerCase())) throw new Error("browser host is not allowlisted"); await this.#driver.navigate(this.profile(workspaceId), url) }
  async snapshot(workspaceId: string): Promise<unknown> { if (this.#switches.isEngaged("browser")) throw new Error("browser is disabled"); return this.#driver.snapshot(this.profile(workspaceId)) }
  async screenshot(workspaceId: string): Promise<Uint8Array> { if (this.#switches.isEngaged("browser")) throw new Error("browser is disabled"); return this.#driver.screenshot(this.profile(workspaceId)) }
  async quarantineDownload(workspaceId: string, filename: string, bytes: Uint8Array): Promise<string> { if (this.#switches.isEngaged("browser")) throw new Error("browser is disabled"); if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) throw new Error("unsafe download filename"); return this.#driver.quarantineDownload(this.profile(workspaceId), filename, bytes) }
}
