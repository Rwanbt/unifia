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

/* ------------------------------------------------------------------ */
/* PostM3-R2 — Browser isolation contracts (Plan V2.3.1 §218, ADR-013)*/
/* ------------------------------------------------------------------ */

/**
 * Browser isolation contracts.
 *
 * The browser automation broker above (M1 era) is the *driver*
 * (Playwright / Puppeteer behind a profile). These schemas are the
 * *trust boundary* for any webview that runs Unifia content
 * (artifacts, generative UI, document packs). The CSP and iframe
 * sandbox together make the browser tab a "container" with
 * strictly limited capabilities — the runtime can prove, by
 * reading these values, that the iframe cannot reach origins or
 * APIs the policy forbids.
 *
 * BR-01 — Browser isolation (CSP + iframe sandbox).
 * BR-02 — Egress control (allowlist of origins, cookie policy).
 */
import { z } from "zod"

/* ------------------------------------------------------------------ */
/* BR-01 — Browser isolation (CSP + iframe sandbox)                   */
/* ------------------------------------------------------------------ */

/**
 * Maximum length of a CSP directive string. Real-world CSPs for
 * the same app rarely exceed 1 KB; anything larger is almost
 * certainly a copy-paste mistake or a config injection attempt.
 */
export const CSP_DIRECTIVE_MAX_CHARS = 1024

// See ADR-1035 §1: broader sandbox tokens grant untrusted artifacts extra capabilities.
export const IFRAME_SANDBOX_VALUES: ReadonlySet<string> = new Set(["allow-scripts"])

export const BrowserIsolationSchema = z
  .object({
    /** Content Security Policy directive. Must be at least 1 directive. */
    csp: z.string().min(1).max(CSP_DIRECTIVE_MAX_CHARS),
    /** iframe sandbox values. Empty array = fully sandboxed. */
    iframeSandbox: z
      .array(z.string())
      .readonly()
      .default([])
      .refine((tokens) => tokens.every((token) => IFRAME_SANDBOX_VALUES.has(token)), {
        message: "browser: iframeSandbox contains a disallowed token",
      }),
  })
export type BrowserIsolation = z.infer<typeof BrowserIsolationSchema>

export function parseBrowserIsolation(input: unknown): BrowserIsolation {
  return BrowserIsolationSchema.parse(input)
}

/* ------------------------------------------------------------------ */
/* BR-02 — Egress control                                             */
/* ------------------------------------------------------------------ */

/** Maximum length of an origin string in the allowlist. */
export const EGRESS_ORIGIN_MAX_CHARS = 1024

/** Default-deny semantics (allowlist). Block-by-default is the
 *  safe direction; only the rare "dev / open" profile flips this. */
export const EGRESS_DEFAULT_DENY = true

export const BrowserEgressPolicySchema = z.object({
  /**
   * Allowed origins for fetch / XHR. Pattern: `https://example.com`
   * or `*` (a literal asterisk, not a wildcard host). Empty array
   * + `defaultDeny: true` = "no egress at all".
   */
  allowedOrigins: z
    .array(z.string().min(1).max(EGRESS_ORIGIN_MAX_CHARS))
    .readonly()
    .default([]),
  /** Whether to block third-party cookies. Default true. */
  blockThirdPartyCookies: z.boolean().default(true),
  /** Whether to deny by default (allowlist) or allow by default (blocklist). */
  defaultDeny: z.boolean().default(EGRESS_DEFAULT_DENY),
})
export type BrowserEgressPolicy = z.infer<typeof BrowserEgressPolicySchema>

export function parseBrowserEgressPolicy(input: unknown): BrowserEgressPolicy {
  return BrowserEgressPolicySchema.parse(input)
}
