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
import type { P3Capability } from "./p3.js"

export const BrowserRuntimeProfileSchema = z.enum(["host-assisted", "isolated"])
export const BrowserControllerSchema = z.enum(["user", "ai", "paused"])
export const BrowserSessionStatusSchema = z.enum(["starting", "ready", "error", "closed"])
export const BrowserTabStatusSchema = z.enum(["loading", "ready", "error", "crashed"])
export const BrowserInteractionActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), selector: z.string().min(1) }),
  z.object({ kind: z.literal("type"), selector: z.string().min(1), text: z.string() }),
  z.object({ kind: z.literal("hover"), selector: z.string().min(1) }),
  z.object({ kind: z.literal("select"), selector: z.string().min(1), value: z.string() }),
  z.object({ kind: z.literal("key"), key: z.string().min(1) }),
  z.object({ kind: z.literal("scroll"), deltaX: z.number().finite(), deltaY: z.number().finite() }),
])
export const BrowserViewportInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pointer"), x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(), button: z.enum(["left", "middle", "right"]).default("left") }),
  z.object({ kind: z.literal("text"), text: z.string().max(4096) }),
  z.object({ kind: z.literal("key"), key: z.string().min(1).max(32) }),
  z.object({ kind: z.literal("scroll"), deltaX: z.number().finite(), deltaY: z.number().finite() }),
])
export const BrowserHistoryActionSchema = z.enum(["back", "forward", "reload"])
const MAX_BROWSER_VIEWPORT_DIMENSION = 4096
export const MAX_BROWSER_UPLOAD_BYTES = 4 * 1024 * 1024
const MAX_BROWSER_UPLOAD_BASE64_CHARS = Math.ceil(MAX_BROWSER_UPLOAD_BYTES / 3) * 4
export const MAX_BROWSER_UPLOAD_REQUEST_BYTES = MAX_BROWSER_UPLOAD_BASE64_CHARS + 4096
export const BrowserUploadInputSchema = z.object({
  name: z.string().min(1).max(255).refine((value) => !/[\\/\0]/.test(value) && value !== "." && value !== "..", "browser: upload name must be a filename"),
  mediaType: z.string().min(1).max(128).regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/),
  base64: z.string().min(4).max(MAX_BROWSER_UPLOAD_BASE64_CHARS).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
})
export const BrowserObservationSchema = z.object({
  id: z.string().min(1), sessionId: z.string().min(1), tabId: z.string().min(1), pageId: z.string().min(1),
  url: z.string().min(1), origin: z.string().refine(isCanonicalHttpOrigin).nullable(), stateDigest: z.string().regex(/^[a-f0-9]{64}$/), capturedAt: z.number().int().nonnegative(),
})

export const BrowserViewportSchema = z.object({
  width: z.number().int().positive().max(MAX_BROWSER_VIEWPORT_DIMENSION),
  height: z.number().int().positive().max(MAX_BROWSER_VIEWPORT_DIMENSION),
})

export const BrowserTabSchema = z.object({
  id: z.string().min(1),
  pageId: z.string().min(1),
  url: z.string().min(1),
  origin: z.string().refine(isCanonicalHttpOrigin).nullable(),
  title: z.string(),
  faviconUrl: z.string().url().optional(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  status: BrowserTabStatusSchema,
})

export const BrowserSessionSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    chatSessionId: z.string().min(1).optional(),
    profileId: z.string().min(1),
    runtimeProfile: BrowserRuntimeProfileSchema,
    controller: BrowserControllerSchema,
    tabs: z.array(BrowserTabSchema).readonly(),
    activeTabId: z.string().min(1).nullable(),
    viewport: BrowserViewportSchema,
    status: BrowserSessionStatusSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .refine(
    ({ tabs, activeTabId }) =>
      tabs.length === 0 ? activeTabId === null : activeTabId !== null && tabs.some((tab) => tab.id === activeTabId),
    { message: "browser: activeTabId must identify a tab, or be null when there are no tabs" },
  )
  .refine(
    ({ tabs }) =>
      new Set(tabs.map((tab) => tab.id)).size === tabs.length &&
      new Set(tabs.map((tab) => tab.pageId)).size === tabs.length,
    { message: "browser: tab and page ids must be unique within a session", path: ["tabs"] },
  )
  .refine(({ createdAt, updatedAt }) => updatedAt >= createdAt, {
    message: "browser: updatedAt cannot be earlier than createdAt",
    path: ["updatedAt"],
  })

export type BrowserRuntimeProfile = z.infer<typeof BrowserRuntimeProfileSchema>
export type BrowserController = z.infer<typeof BrowserControllerSchema>
export type BrowserSessionStatus = z.infer<typeof BrowserSessionStatusSchema>
export type BrowserTabStatus = z.infer<typeof BrowserTabStatusSchema>
export type BrowserInteractionAction = z.infer<typeof BrowserInteractionActionSchema>
export type BrowserViewportInput = z.infer<typeof BrowserViewportInputSchema>
export type BrowserHistoryAction = z.infer<typeof BrowserHistoryActionSchema>
export type BrowserObservation = z.infer<typeof BrowserObservationSchema>
export type BrowserViewport = z.infer<typeof BrowserViewportSchema>
export type BrowserTab = z.infer<typeof BrowserTabSchema>
export type BrowserSession = z.infer<typeof BrowserSessionSchema>

export const BrowserDownloadStatusSchema = z.enum(["quarantined", "released"])
export const BrowserDownloadInspectionSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mediaType: z.string().min(1).max(128),
  classification: z.enum(["document", "image", "archive", "text", "executable", "unknown"]),
  extensionStatus: z.enum(["match", "mismatch", "unknown"]),
  malwareScan: z.enum(["clean", "malicious", "unavailable"]),
})
export const BrowserDownloadSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  tabId: z.string().min(1),
  filename: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  status: BrowserDownloadStatusSchema,
  inspection: BrowserDownloadInspectionSchema,
  createdAt: z.number().int().nonnegative(),
  releasedFilename: z.string().min(1).max(180).optional(),
})
export type BrowserDownloadStatus = z.infer<typeof BrowserDownloadStatusSchema>
export type BrowserDownloadInspection = z.infer<typeof BrowserDownloadInspectionSchema>
export type BrowserDownload = z.infer<typeof BrowserDownloadSchema>

export type BrowserSessionManager = {
  create(input: { workspaceId: string; chatSessionId?: string; runtimeProfile: BrowserRuntimeProfile; viewport: BrowserViewport; capabilities?: readonly P3Capability[] }): BrowserSession | Promise<BrowserSession>
  bindCapabilities?(sessionId: string, capabilities: readonly P3Capability[]): void
  forChatSession(workspaceId: string, chatSessionId: string): { sessionId: string; capabilities: readonly P3Capability[] } | undefined
  get(sessionId: string): BrowserSession
  openTab(sessionId: string, url?: string): Promise<BrowserSession>
  navigate(sessionId: string, tabId: string, url: string, controller: "user" | "ai", approvedOrigin?: string): Promise<BrowserSession>
  history(sessionId: string, tabId: string, action: BrowserHistoryAction): Promise<BrowserSession>
  resizeViewport(sessionId: string, viewport: BrowserViewport): Promise<BrowserSession>
  refreshTab(sessionId: string, tabId: string): Promise<BrowserSession>
  selectTab(sessionId: string, tabId: string): Promise<BrowserSession>
  closeTab(sessionId: string, tabId: string): Promise<BrowserSession>
  close(sessionId: string): Promise<void>
  observe(sessionId: string, tabId: string): Promise<{ receipt: BrowserObservation; modelText: string }>
  actionApprovalRequirement(sessionId: string, tabId: string, observationId: string, action: BrowserInteractionAction): Promise<string | undefined>
  act(sessionId: string, tabId: string, observationId: string, action: BrowserInteractionAction, approveSensitiveAction?: (reason: string) => Promise<void>): Promise<void>
  input(sessionId: string, tabId: string, action: BrowserViewportInput): Promise<void>
  upload(sessionId: string, tabId: string, file: { name: string; mediaType: string; bytes: Uint8Array }): Promise<void>
  screenshot(sessionId: string, tabId: string): Promise<Uint8Array>
  downloads(sessionId: string): readonly BrowserDownload[]
  releaseDownload(sessionId: string, downloadId: string): Promise<BrowserDownload>
  takeControl(sessionId: string, controller: BrowserController): Promise<BrowserSession>
  activity(sessionId: string, after?: number): readonly BrowserActivityEvent[]
  shutdown(): Promise<void>
}

export type BrowserToolContext = { sessions: BrowserSessionManager; sessionId: string; capabilities: readonly P3Capability[] }

export type BrowserActivityKind = "session.created" | "tab.opened" | "tab.navigated" | "navigation.blocked" | "network.blocked" | "tab.selected" | "tab.closed" | "page.observed" | "action.approval_required" | "action.approval_denied" | "action.approval_unavailable" | "action.approval_cancelled" | "action.started" | "action.completed" | "action.cancelled" | "action.failed" | "user.input" | "user.upload" | "controller.changed" | "viewport.changed" | "download.quarantined" | "download.released" | "download.failed" | "session.closed"
export type BrowserActivityEvent = {
  sequence: number
  sessionId: string
  tabId?: string
  kind: BrowserActivityKind
  controller: BrowserController
  occurredAt: number
  detail?: string
}

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

function isCanonicalHttpOrigin(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.hostname.includes("*") &&
      parsed.origin === value
    )
  } catch {
    return false
  }
}

function isCanonicalBrowserOrigin(value: string): boolean {
  return value === "*" || isCanonicalHttpOrigin(value)
}

export const BrowserEgressPolicySchema = z.object({
  /**
   * Allowed origins for fetch / XHR. Pattern: `https://example.com`
   * or `*` (a literal asterisk, not a wildcard host). Empty array
   * + `defaultDeny: true` = "no egress at all".
   */
  allowedOrigins: z
    .array(
      z
        .string()
        .min(1)
        .max(EGRESS_ORIGIN_MAX_CHARS)
        .refine(isCanonicalBrowserOrigin, "browser: allowed origin must be a canonical HTTP(S) origin or '*'")
    )
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
