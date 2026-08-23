import type { ApprovalBroker, ApprovalRequestRecord, AuditEvent, CapabilityRegistry, BrowserAutomationBroker, McpUiControlBroker, UiAction, CapabilityManifest, DesktopAutomationBroker, WorkspaceManifest } from "@unifia/contracts"
/* SPDX-License-Identifier: MIT */
import type { MemoryRuntime } from "@unifia/memory-runtime"
import type { WorkflowDefinition, WorkflowRuntime } from "@unifia/workflow-runtime"
import type { ArtifactStore } from "@unifia/artifact-runtime"
import { parseSpec, resolveEffectiveCapabilities } from "@unifia/spec-runtime"
import type { SkillRegistry } from "@unifia/skill-hub"
import type { DesignSkillManifest } from "@unifia/skill-hub"
import { renderGenerativeUi, type UiNode } from "@unifia/contracts"
import { WIRE_PROTOCOL_VERSION, parseHandshakeRequest } from "@unifia/contracts/workbench-wire"
import type {
  FileReadResult,
  FileWrite,
  P3Capability,
  RuntimeAdapter,
  RuntimeEvent,
  WorkspaceHandle,
  WorkspacePort,
} from "@unifia/contracts"
import { migrateWorkspaceManifest, WORKSPACE_MANIFEST_PATH } from "@unifia/contracts"

import { randomUUID } from "node:crypto"
import { basename } from "node:path"
import { FixedWindowRateLimiter, principalCanOpen, principalCanRegister, type Principal, type PrincipalAuthenticator, type RateLimiter, type ScopedToken, type ScopedTokenAuthority, type ScopedTokenRequest } from "./auth.js"
import type { PresentLinkSigner } from "./present-link.js"
import { OperationRegistry } from "./operations.js"
import { addSecurityHeaders, checkRequestOrigin } from "./security.js"

export * from "./auth.js"
export * from "./security.js"
export * from "./operations.js"
export * from "./logging.js"

type AuditPort = { record(actor: string, capability: string, decision: "allow" | "deny" | "approval_required"): unknown; page?: (afterSequence: number, limit: number) => { events: readonly AuditEvent[]; nextCursor: number | null } }
export type CapabilityDecision = "allow" | "deny" | { kind: "approval_required"; approvalId: string }
export type CapabilityGate = { check(capability: P3Capability, resource: string, actor: string): Promise<CapabilityDecision>; getApproval?: (id: string) => { resource: string } | undefined; listApprovals?: (resource: string) => readonly ApprovalRequestRecord[]; resolve?: (id: string, decision: "allow" | "deny", actor: string, grantedResource?: string) => unknown; cancel?: (id: string) => unknown }
export type WorkbenchGithubSurface = { status(workspaceId: string): Promise<Record<string, unknown>>; deviceStart(workspaceId: string): Promise<Record<string, unknown>>; devicePoll(workspaceId: string): Promise<Record<string, unknown>>; deviceCancel(workspaceId: string): Promise<{ ok: boolean }>; disconnect(workspaceId: string): Promise<{ ok: boolean }> }
/**
 * Resolves the artifact lineage for one workspace.
 *
 * WHY a resolver and not one store: ArtifactStore.list() takes no workspace and
 * reads a single directory, so a store shared by every workspace the sidecar
 * serves would let workspace A list and read workspace B's artifacts. The
 * routes all authorize a workspaceId already; this makes the storage honour the
 * same boundary. Tests that only ever use one workspace may still pass a plain
 * store.
 */
export type ArtifactStoreResolver = (workspaceId: string) => ArtifactStore

type ServerDependencies = { auth: PrincipalAuthenticator; rateLimiter?: RateLimiter; workspace: WorkspacePort; runtime: RuntimeAdapter; audit: AuditPort; capability: CapabilityGate; instanceId?: string; tokenIssuer?: ScopedTokenAuthority; artifacts?: ArtifactStore | ArtifactStoreResolver; browser?: BrowserAutomationBroker; desktop?: DesktopAutomationBroker; workflow?: WorkflowRuntime; memory?: MemoryRuntime; capabilities?: CapabilityRegistry; ui?: McpUiControlBroker; uiAllowedActions?: ReadonlySet<string>; skillHub?: SkillRegistry; designSkills?: (workspaceId: string) => Promise<readonly DesignSkillManifest[]>; github?: WorkbenchGithubSurface; allowedOrigins?: readonly string[]; workspaceEventsPollMs?: number; presentLinks?: PresentLinkSigner }

/** Requests per principal per window when the caller injects no limiter. */
const DEFAULT_RATE_BUDGET = 240
const DEFAULT_RATE_WINDOW_MS = 60_000
/** How often GET /v1/workspaces/:id/events re-lists sessions to fan new ones into the stream (C2-2/FUNC-001). */
const DEFAULT_WORKSPACE_EVENTS_POLL_MS = 5_000
/**
 * SEC-001/C2-3 capability matrix, decided 2026-08-17. workspace.read and
 * workspace.watch are granted at connection (READ_CAPABILITIES,
 * provider.tsx) and always in principal.scopes already — they don't need
 * to be listed here. Every capability NOT in principal.scopes and NOT
 * listed here is refused before #checkCapability's gate ever runs:
 * workflow.run, desktop.control, desktop.observe, browser.navigate and
 * package.install have no legitimate caller in this branch (workflow.run
 * in particular: Automate is out of scope, see ADR-1033/C5-4).
 *
 * workspace.write is deliberately NOT step-up eligible either, but it did
 * acquire legitimate callers (Fichiers CRUD, composer uploads, the scoped
 * PTY routes). Those are served by widening the lease the surface requests
 * at connection — SURFACE_LEASE_CAPABILITIES in workbench-shell/routes.ts —
 * so the capability is in principal.scopes and this gate passes it to the
 * broker like any other granted capability. A token that was never issued
 * workspace.write is still refused here without creating an approval.
 *
 * artifact.create and artifact.export remain the only two
 * step-up-eligible capabilities — Design/Work trigger them for real
 * (save/export), so a base-scoped token must still be able to reach the
 * approval gate for these two, not fail closed outright.
 */
const STEP_UP_ELIGIBLE_CAPABILITIES: ReadonlySet<P3Capability> = new Set(["artifact.create", "artifact.export"])

/**
 * Capabilities the desktop sidecar's gate allows without an approval.
 *
 * WHY it is wider than the connection lease: reaching the gate is not passing
 * it. artifact.create/export are step-up eligible, so a leased token reaches
 * the broker — which answered 202 approvalRequired, and no Design surface has
 * an approval UI able to answer one. WorkbenchClient treats 202 as success (it
 * IS `response.ok`), so callers read `result.artifact` off an approval
 * envelope and threw. artifact.preview is not step-up eligible at all and
 * answered a flat 403, leaving ArtifactPreview unable to fetch bytes.
 *
 * Deliberately absent: package.install, workflow.run, desktop.observe,
 * desktop.control, browser.navigate — those still go through the broker.
 * surface-capability.test.ts pins this list against the route registries the
 * Design/Work surfaces actually call.
 */
export const SURFACE_GRANTED_CAPABILITIES: readonly P3Capability[] = [
  "workspace.read",
  "workspace.write",
  "workspace.watch",
  "artifact.preview",
  "artifact.create",
  "artifact.export",
]

/** Exposed so the surface suite can assert the shell's lease agrees with what this server refuses before the gate. */
export const STEP_UP_ELIGIBLE: readonly P3Capability[] = [...STEP_UP_ELIGIBLE_CAPABILITIES]
/** Sentinel racing every session's next() promise so a newly-discovered session can interrupt an in-flight wait. */
const WAKE = Symbol("workspace-events-wake")
type JsonRecord = Record<string, unknown>

/**
 * Content-Type by file extension, for the artifact raw read route (P10).
 * Unknown extensions are served as `application/octet-stream` with
 * `Content-Disposition: attachment` so the browser does not try to
 * render arbitrary bytes as HTML or execute them as script.
 *
 * Kept narrow on purpose: every entry here is a content type we
 * expect an agent-authored artifact to legitimately ship. Adding
 * `text/html` to a `Content-Type` for an unknown extension would
 * re-introduce the XSS surface the sandbox is supposed to close.
 */
const ARTIFACT_RAW_CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
}

/**
 * Content-Security-Policy applied to HTML responses from the artifact raw
 * read route. Mirrors ADR-1036 §1 (the iframe's own CSP). The point
 * of setting the header at the route level is defense in depth: even
 * if a caller downloads the bytes to disk and opens the file in a
 * regular browser, the same controls apply.
 */
const ARTIFACT_RAW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT")
}

function parseManifestResult(content: string | Uint8Array): WorkspaceManifest {
  const raw = typeof content === "string" ? content : new TextDecoder().decode(content)
  return migrateWorkspaceManifest(JSON.parse(raw))
}

/**
 * Serialise one runtime event as a wire-format SSE frame.
 * WHY: the `id:` line is omitted when no sequence exists — emitting an empty
 * `id:` would reset the client's Last-Event-ID and break cursor resumption.
 */
export function sseFrame(event: { sequence?: number }): string {
  const id = typeof event.sequence === "number" ? `id: ${event.sequence}\n` : ""
  return `${id}data: ${JSON.stringify(event)}\n\n`
}

/**
 * Encodes a file read result for the wire.
 *
 * WHY: FileReadResult.content is `string | Uint8Array`, and JSON.stringify turns
 * a Uint8Array into `{"type":"Buffer","data":[104,101,...]}` — a Node-specific
 * blob that no client can rely on and that inflates a text file about sixfold.
 * The encoding is now stated explicitly so the caller can decode deterministically.
 */
export function encodeReadResult(result: FileReadResult): JsonRecord {
  const { content, ...rest } = result
  return typeof content === "string"
    ? { ...rest, content, encoding: "utf-8" }
    : { ...rest, content: Buffer.from(content).toString("base64"), encoding: "base64" }
}

/**
 * Inverse of `encodeReadResult`'s convention, for the write path — an
 * uploaded image or other binary file arrives as base64 text (JSON has no
 * binary type); `encoding` states which decode applies, defaulting to
 * utf-8 for plain create/edit calls that never set it.
 */
function decodeWriteInput(entry: JsonRecord): FileWrite {
  const path = entry.path
  const content = entry.content
  if (typeof path !== "string" || typeof content !== "string") throw new Error("invalid file write entry")
  const bytes = entry.encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8")
  return { path, content: bytes }
}

async function body(request: Request): Promise<JsonRecord> {
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body must be an object")
    return value as JsonRecord
  } catch { throw new Error("invalid JSON body") }
}

export class WorkbenchServer {
  readonly #workspace: WorkspacePort
  readonly #runtime: RuntimeAdapter
  readonly #audit: AuditPort
  readonly #capability: CapabilityGate
  readonly #artifacts?: ArtifactStore | ArtifactStoreResolver
  readonly #browser?: BrowserAutomationBroker
  readonly #desktop?: DesktopAutomationBroker
  readonly #workflow?: WorkflowRuntime
  readonly #memory?: MemoryRuntime
  readonly #capabilities?: CapabilityRegistry
  readonly #ui?: McpUiControlBroker
  readonly #uiAllowedActions?: ReadonlySet<string>
  readonly #workflowOwners = new Map<string, string>()
  readonly #workflowOwnerLimit = 1_000
  readonly #tokens = new Map<string, WorkspaceHandle>()
  readonly #runtimeTokens = new Map<string, string>()
  readonly #nativeTokens = new Map<string, Set<string>>()
  readonly #sessionOwners = new Map<string, string>()
  readonly #skillHub?: SkillRegistry
  readonly #designSkills?: (workspaceId: string) => Promise<readonly DesignSkillManifest[]>
  readonly #github?: WorkbenchGithubSurface
  readonly #auth: PrincipalAuthenticator
  readonly #rateLimiter: RateLimiter
  readonly #instanceId: string
  readonly #tokenIssuer?: ScopedTokenAuthority
  readonly #presentLinks?: PresentLinkSigner
  readonly #operations = new OperationRegistry(() => `operation-${randomUUID()}`)
  readonly #allowedOrigins?: readonly string[]
  readonly #workspaceEventsPollMs: number

  constructor(dependencies: ServerDependencies) {
    this.#auth = dependencies.auth
    this.#instanceId = dependencies.instanceId ?? randomUUID()
    this.#tokenIssuer = dependencies.tokenIssuer
    this.#presentLinks = dependencies.presentLinks
    this.#allowedOrigins = dependencies.allowedOrigins
    this.#workspaceEventsPollMs = dependencies.workspaceEventsPollMs ?? DEFAULT_WORKSPACE_EVENTS_POLL_MS
    // WHY: a limiter is always installed. An absent `rateLimiter` must mean
    // "use the default budget", never "no limit" — omission must not disable a
    // control.
    this.#rateLimiter = dependencies.rateLimiter ?? new FixedWindowRateLimiter(DEFAULT_RATE_BUDGET, DEFAULT_RATE_WINDOW_MS)
    this.#workspace = dependencies.workspace
    this.#runtime = dependencies.runtime
    this.#audit = dependencies.audit
    this.#capability = dependencies.capability
    this.#artifacts = dependencies.artifacts
    this.#browser = dependencies.browser
    this.#desktop = dependencies.desktop
    this.#workflow = dependencies.workflow
    this.#memory = dependencies.memory
    this.#capabilities = dependencies.capabilities
    this.#ui = dependencies.ui
    this.#uiAllowedActions = dependencies.uiAllowedActions
    this.#skillHub = dependencies.skillHub
    this.#designSkills = dependencies.designSkills
    this.#github = dependencies.github
  }

  /**
   * WHY the router is awaited in a separate method: this method used to inline
   * the if-chain and `return this.#handler(...)` without awaiting. In an async
   * function a returned promise settles *outside* the try block, so the catch
   * below never saw a handler rejection — the error path was dead for every
   * route, and a failing handler escaped as an unhandled rejection instead of
   * an audited 400. In-memory tests never rejected, so nothing revealed it.
   */
  async fetch(request: Request): Promise<Response> {
    // WHY hoisted above the try: SEC-002 — a handler that throws after origin
    // validation (e.g. a malformed JSON body) must still get nosniff and
    // access-control-allow-origin on its error response, or a fetch from an
    // allowed origin fails opaquely in the browser instead of surfacing the
    // real 400.
    let origin: ReturnType<typeof checkRequestOrigin> | undefined
    try {
      origin = checkRequestOrigin(request.headers.get("origin"), this.#allowedOrigins)
      if (!origin.allowed) return addSecurityHeaders(json(403, { error: "origin not allowed" }))
      if (request.method === "OPTIONS") return addSecurityHeaders(new Response(null, { status: 204 }), origin.origin)
      return addSecurityHeaders(await this.#route(request), origin.origin)
    } catch (error) {
      this.#audit.record("workbench-server", "request.error", "deny")
      return addSecurityHeaders(json(400, { error: error instanceof Error ? error.message : "request failed" }), origin?.allowed ? origin.origin : undefined)
    }
  }

  /**
   * Native bridge boundary for short-lived scoped credentials.
   * WHY this is a method instead of an HTTP route: the signing key and issuer
   * must remain inside the native/server process and never become WebView data.
   */
  async issueNativeScopedToken(request: Omit<ScopedTokenRequest, "instanceId">): Promise<ScopedToken> {
    if (!this.#tokenIssuer) throw new Error("scoped token issuer is not configured")
    const token = this.#tokenIssuer.issue({ ...request, instanceId: this.#instanceId })
    await this.#registerNativeToken(token)
    this.#allow("token.issue")
    return token
  }

  async rotateNativeScopedToken(request: Omit<ScopedTokenRequest, "instanceId">): Promise<{ token: ScopedToken; previousToken: string | null; gracePeriodMs: number }> {
    if (!this.#tokenIssuer) throw new Error("scoped token issuer is not configured")
    const rotation = this.#tokenIssuer.rotate({ ...request, instanceId: this.#instanceId })
    await this.#registerNativeToken(rotation.token)
    if (rotation.previousToken) await this.#registerNativeToken({ ...rotation.token, token: rotation.previousToken })
    this.#allow("token.rotate")
    return rotation
  }

  async revokeNativeScopedToken(workspaceId: string): Promise<void> {
    if (!this.#tokenIssuer) throw new Error("scoped token issuer is not configured")
    this.#tokenIssuer.revoke({ workspaceId, instanceId: this.#instanceId })
    for (const token of this.#nativeTokens.get(workspaceId) ?? []) {
      await this.#workspace.close(this.#runtimeTokens.get(token) ?? token).catch(() => undefined)
      this.#runtimeTokens.delete(token)
      this.#tokens.delete(token)
    }
    this.#nativeTokens.delete(workspaceId)
    this.#allow("token.revoke")
  }

  async #route(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const segments = url.pathname.split("/").filter(Boolean)
      if (segments[0] !== "v1") return this.#deny("route.unknown", 404)
      // Phase 9.4 — dispatched before the universal principal gate below:
      // a present link's own signed token IS its authentication, verified
      // inside the handler. Requiring a Bearer principal here would defeat
      // the entire point of a link meant for someone who never
      // authenticated with this server.
      if (segments[1] === "artifacts" && segments[3] === "present" && request.method === "GET") return this.#artifactPresent(request, segments[2])
      const principal = await this.#authenticate(request)
      if (!principal) return this.#deny("auth.principal", 401)
      if (!this.#rateLimiter.take(principal.id)) return this.#deny("auth.rate-limit", 429)
      if (request.method === "POST" && segments[1] === "handshake") return this.#handshake(request)
      if (request.method === "POST" && segments[1] === "workspaces" && segments[2] === "register") return this.#register(request, principal)
      if (segments[1] === "workspaces" && segments[3] === "open" && request.method === "POST") return this.#open(segments[2], principal)
      if (segments[1] === "workspaces" && segments[3] === "sessions") return this.#sessions(request, segments[2])
      if (segments[1] === "workspaces" && segments[3] === "events" && request.method === "GET") return this.#workspaceEvents(request, segments[2], principal)
      if (segments[1] === "sessions" && segments[3] === "prompt" && request.method === "POST") return this.#prompt(request, segments[2])
      if (segments[1] === "sessions" && segments[3] === "events" && request.method === "GET") return this.#events(request, segments[2], principal)
      if (segments[1] === "operations" && segments[3] === "cancel" && request.method === "POST") return this.#cancelOperation(request, segments[2], principal)
      if (segments[1] === "files" && (segments[2] === "read" || segments[2] === "write" || segments[2] === "create" || segments[2] === "remove" || segments[2] === "rename") && request.method === "POST") return this.#files(request, segments[2], principal)
      if (segments[1] === "files" && (segments[2] === "list" || segments[2] === "search") && request.method === "GET") return this.#fileIndex(request, segments[2], principal)
      if (segments[1] === "design-systems" && request.method === "GET") return this.#designSystems(request, principal)
      if (segments[1] === "file-sessions" && request.method === "DELETE") return this.#closeFileSession(request, segments[2])
      if (segments[1] === "approvals" && request.method === "GET") return this.#approvalList(request)
      if (segments[1] === "approvals" && (request.method === "POST" || request.method === "DELETE")) return this.#approval(request, segments[2])
      if (segments[1] === "trace" && request.method === "GET") return this.#auditPage(request, "trace")
      if (segments[1] === "activity" && request.method === "GET") return this.#auditPage(request, "activity")
      if (segments[1] === "artifacts" && segments[3] === "raw" && request.method === "GET") return this.#artifactRaw(request, segments[2], segments.slice(4).join("/"), principal)
      if (segments[1] === "artifacts" && segments[3] === "present" && request.method === "POST") return this.#artifactPresentLink(request, segments[2], principal)
      if (segments[1] === "artifacts" && segments[3] === "history" && request.method === "GET") return this.#artifactHistory(request, segments[2], principal)
      if (segments[1] === "artifacts" && request.method === "GET") return this.#artifactRead(request, segments[2], principal)
      if (segments[1] === "artifacts" && segments[2] === "export" && request.method === "POST") return this.#artifactExport(request, principal)
      if (segments[1] === "artifacts" && request.method === "POST") return this.#artifactWrite(request, principal)
      if (segments[1] === "documents" && request.method === "GET") return this.#documents(request, principal)
      if (segments[1] === "specs" && segments[2] === "validate" && request.method === "POST") return this.#specValidate(request, principal)
      if (segments[1] === "browser" && request.method === "POST") return this.#browserAction(request, segments[2], principal)
      if (segments[1] === "desktop" && request.method === "POST") return this.#desktopAction(request, segments[2], principal)
      if (segments[1] === "workflows" && request.method === "POST") return this.#workflowAction(request, segments[2], principal)
      if (segments[1] === "memory" && (request.method === "GET" || request.method === "POST" || request.method === "DELETE")) return this.#memoryAction(request, segments[2], principal)
      if (segments[1] === "capabilities" && (request.method === "GET" || request.method === "POST")) return this.#capabilityAction(request, segments[2], principal)
      if (segments[1] === "ui" && segments[2] === "actions" && request.method === "POST") return this.#uiAction(request, principal)
      if (segments[1] === "ui" && segments[2] === "render" && request.method === "POST") return this.#renderUi(request)
      if (segments[1] === "skill-hub" && (segments[2] === "search" || segments[2] === "install" || segments[2] === "update") && ((request.method === "GET" && segments[2] === "search") || request.method === "POST")) return this.#skillHubAction(request, segments[2])
      if (segments[1] === "design-skills" && request.method === "GET") return this.#designSkillsAction(request, principal)
      if (segments[1] === "github" && segments[2] === "status" && request.method === "GET") return this.#githubAction(request, "status", principal)
      if (segments[1] === "github" && segments[2] === "device" && request.method === "POST") return this.#githubAction(request, segments[3] ?? "", principal)
      if (segments[1] === "github" && segments[2] === "disconnect" && request.method === "POST") return this.#githubAction(request, "disconnect", principal)
      if (segments[1] === "plugins" && request.method === "GET" && !segments[2]) return this.#pluginsList(request, principal)
      if (segments[1] === "plugins" && segments[2] && request.method === "GET" && !segments[3]) return this.#pluginRead(request, segments[2], principal)
      if (segments[1] === "plugins" && segments[2] === "install" && request.method === "POST" && segments[3]) return this.#pluginInstall(request, segments[3], principal)
      if (segments[1] === "plugins" && segments[2] === "apply" && request.method === "POST" && segments[3]) return this.#pluginApply(request, segments[3], principal)
      if (segments[1] === "plugins" && segments[2] && request.method === "DELETE" && !segments[3]) return this.#pluginDelete(request, segments[2], principal)
      return this.#deny("route.unknown", 404)
  }

  async #authenticate(request: Request): Promise<Principal | undefined> {
    const principal = await this.#auth.authenticate(request)
    if (principal) return principal
    const bearer = this.#bearer(request)
    if (!bearer || !this.#tokenIssuer) return undefined
    const token = this.#tokenIssuer.verify(bearer)
    if (!token) return undefined
    return {
      id: token.principalId,
      scopes: new Set(["workspace.open", ...token.capabilities]),
      workspaces: new Set([token.workspaceId]),
    }
  }

  async #registerNativeToken(token: ScopedToken): Promise<void> {
    const runtimeHandle = await this.#workspace.open(token.workspaceId)
    this.#tokens.set(token.token, { id: token.workspaceId, token: token.token })
    this.#runtimeTokens.set(token.token, runtimeHandle.token)
    const tokens = this.#nativeTokens.get(token.workspaceId) ?? new Set<string>()
    tokens.add(token.token)
    this.#nativeTokens.set(token.workspaceId, tokens)
  }

  async #handshake(request: Request): Promise<Response> {
    const input = parseHandshakeRequest(await body(request))
    const supported = input.protocolVersion === WIRE_PROTOCOL_VERSION && input.supportedVersions.includes(WIRE_PROTOCOL_VERSION)
    if (!supported) {
      this.#audit.record("workbench-server", "handshake.unsupported-version", "deny")
      return json(200, {
        kind: "workbench.handshake.refused",
        accepted: false,
        protocolVersion: null,
        supportedVersions: [WIRE_PROTOCOL_VERSION],
        instanceId: this.#instanceId,
        reason: "unsupported-version",
      })
    }
    this.#audit.record("workbench-server", "handshake.accept", "allow")
    return json(200, {
      kind: "workbench.handshake.accepted",
      accepted: true,
      protocolVersion: WIRE_PROTOCOL_VERSION,
      supportedVersions: [WIRE_PROTOCOL_VERSION],
      instanceId: this.#instanceId,
    })
  }

  async #register(request: Request, principal: Principal): Promise<Response> {
    if (!principalCanRegister(principal)) return this.#deny("workspace.register.scope", 403)
    const input = await body(request)
    if (typeof input.name !== "string" || typeof input.path !== "string") return this.#deny("workspace.register", 400)
    const workspace = await this.#workspace.register({ name: input.name, path: input.path })
    this.#allow("workspace.register")
    return json(201, workspace as unknown as JsonRecord)
  }

  async #open(workspaceId: string, principal: Principal): Promise<Response> {
    if (!principalCanOpen(principal, workspaceId)) return this.#deny("workspace.open.scope", 403)
    const handle = await this.#workspace.open(workspaceId)
    this.#tokens.set(handle.token, handle)
    this.#allow("workspace.open")
    return json(200, handle as unknown as JsonRecord)
  }

  async #sessions(request: Request, workspaceId: string): Promise<Response> {
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("session.scope", 403)
    if (request.method === "GET") {
      const sessions = await this.#runtime.listSessions({ workspaceId })
      for (const session of sessions) this.#sessionOwners.set(session.id, workspaceId)
      this.#allow("session.list")
      return json(200, { sessions })
    }
    if (request.method === "POST") {
      const session = await this.#runtime.createSession({ workspaceId })
      this.#sessionOwners.set(session.id, workspaceId)
      this.#allow("session.create")
      return json(201, { session })
    }
    return this.#deny("session.method", 405)
  }

  async #events(request: Request, sessionId: string, principal: Principal): Promise<Response> {
    const workspaceId = this.#sessionOwners.get(sessionId)
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("session.events.scope", 403)
    const eventGate = await this.#checkCapability("workspace.watch", workspaceId, principal)
    if (eventGate) return eventGate
    const requestedCursor = Number(request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? "0")
    const afterSequence = Number.isSafeInteger(requestedCursor) && requestedCursor > 0 ? requestedCursor : 0
    const iterator = this.#runtime.subscribeEvents({ sessionId, afterSequence })[Symbol.asyncIterator]()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // WHY an immediate comment frame: without any byte on the wire the
        // client can stall waiting for headers to flush, and an idle connection
        // is a candidate for proxy and server idle timeouts before the first
        // real event ever arrives. A comment line is ignored by SSE parsers.
        controller.enqueue(encoder.encode(": unifia stream open\n\n"))
      },
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (next.done) controller.close()
          else controller.enqueue(encoder.encode(sseFrame(next.value)))
        } catch (error) {
          controller.error(error)
        }
      },
      async cancel() { await iterator.return?.() },
    })
    this.#allow("session.events")
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" } })
  }

  /**
   * FUNC-001/C2-2: the client connects once per workspace and expects one
   * merged event stream across every session in it — there is no
   * "workspace-scoped" primitive on RuntimeAdapter, every implementation
   * (Fake/OpenCode/Unifia) is session-scoped. This fans in each known
   * session's subscribeEvents() into one SSE stream, and periodically
   * re-lists sessions (no "session created" push notification exists on
   * RuntimeAdapter) to join sessions created after the stream opened.
   *
   * Sequence numbers are per-session (see FakeRuntimeAdapter), not
   * comparable across sessions, so v1 does not support cross-session
   * resumption: every session (initial or discovered later) always starts
   * its own subscription at afterSequence 0. A dropped connection restarts
   * every session's stream from 0 rather than replaying only the gap —
   * acceptable for now; a composite per-session cursor is future work if
   * that turns out to matter.
   */
  async #workspaceEvents(request: Request, workspaceId: string, principal: Principal): Promise<Response> {
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("workspace.events.scope", 403)
    const eventGate = await this.#checkCapability("workspace.watch", workspaceId, principal)
    if (eventGate) return eventGate

    const encoder = new TextEncoder()
    const iterators = new Map<string, AsyncIterator<RuntimeEvent>>()
    const pending = new Map<string | typeof WAKE, Promise<{ sessionId: string | typeof WAKE; result?: IteratorResult<RuntimeEvent> }>>()
    let pollTimer: ReturnType<typeof setInterval> | undefined

    const arm = (sessionId: string, iterator: AsyncIterator<RuntimeEvent>) => {
      pending.set(sessionId, iterator.next().then((result) => ({ sessionId, result })))
    }
    const armWake = () => {
      pending.set(WAKE, new Promise((resolve) => { wakeResolve = () => resolve({ sessionId: WAKE }) }))
    }
    let wakeResolve: () => void = () => {}
    armWake()

    const addSession = (sessionId: string) => {
      if (iterators.has(sessionId)) return
      const iterator = this.#runtime.subscribeEvents({ sessionId, afterSequence: 0 })[Symbol.asyncIterator]()
      iterators.set(sessionId, iterator)
      arm(sessionId, iterator)
      wakeResolve()
      armWake()
    }
    for (const session of await this.#runtime.listSessions({ workspaceId })) addSession(session.id)

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode(": unifia stream open\n\n"))
        pollTimer = setInterval(() => {
          this.#runtime.listSessions({ workspaceId }).then((sessions) => {
            for (const session of sessions) addSession(session.id)
          }).catch(() => { /* transient listSessions failure: keep streaming already-known sessions */ })
        }, this.#workspaceEventsPollMs)
      },
      pull: async (controller) => {
        while (true) {
          const winner = await Promise.race(pending.values())
          if (winner.sessionId === WAKE) continue // a session was added mid-race; re-race with the updated set
          pending.delete(winner.sessionId)
          if (!winner.result || winner.result.done) { iterators.delete(winner.sessionId); continue }
          arm(winner.sessionId, iterators.get(winner.sessionId)!)
          controller.enqueue(encoder.encode(sseFrame(winner.result.value)))
          return
        }
      },
      cancel: async () => {
        if (pollTimer) clearInterval(pollTimer)
        await Promise.all([...iterators.values()].map((iterator) => iterator.return?.()))
      },
    })
    this.#allow("workspace.events")
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" } })
  }

  async #prompt(request: Request, sessionId: string): Promise<Response> {
    const workspaceId = this.#sessionOwners.get(sessionId)
    const token = workspaceId ? this.#authorize(request, workspaceId) : undefined
    if (!token || !workspaceId) return this.#deny("session.prompt.scope", 403)
    const input = await body(request)
    if (typeof input.prompt !== "string") return this.#deny("session.prompt", 400)
    const operation = this.#operations.start(workspaceId, sessionId, typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined)
    if (operation.state === "completed") return json(202, { accepted: true, workspaceId, operationId: operation.id })
    void this.#runPrompt(operation.id, sessionId, input.prompt)
    this.#allow("session.prompt")
    return json(202, { accepted: true, workspaceId, operationId: operation.id })
  }

  async #runPrompt(operationId: string, sessionId: string, prompt: string): Promise<void> {
    try {
      await this.#runtime.sendPrompt({ sessionId, prompt })
      this.#operations.complete(operationId)
    } catch (error) {
      this.#operations.fail(operationId, error)
    }
  }

  async #cancelOperation(request: Request, operationId: string, principal: Principal): Promise<Response> {
    const operation = this.#operations.get(operationId)
    if (!operation || !this.#authorize(request, operation.workspaceId)) return this.#deny("operation.cancel.scope", 403)
    const gate = await this.#checkCapability("workspace.watch", operation.workspaceId, principal)
    if (gate) return gate
    const cancelled = this.#operations.cancel(operationId)
    if (!cancelled) return this.#deny("operation.cancel", 409)
    await this.#runtime.cancelSession(operation.sessionId)
    this.#allow("operation.cancel")
    return json(200, { operation: cancelled })
  }

  async #files(request: Request, operation: "read" | "write" | "create" | "remove" | "rename", principal: Principal): Promise<Response> {
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || (!Array.isArray(input.paths) && operation === "read")) return this.#deny(`workspace.${operation}`, 400)
    const workspaceId = input.workspaceId
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny(`workspace.${operation}.scope`, 403)
    // create/remove/rename mutate the workspace filesystem exactly like
    // write does — reusing "workspace.write" here keeps the P3 capability
    // catalogue closed rather than adding a "workspace.delete" the
    // capability broker, approval UI, and picker would all need to learn
    // about for a distinction nothing downstream has asked for.
    const capability = (operation === "read" ? "workspace.read" : "workspace.write") as P3Capability
    const capabilityResponse = await this.#checkCapability(capability, workspaceId, principal)
    if (capabilityResponse) return capabilityResponse
    if (operation === "read") {
      const results = await this.#workspace.read(this.#runtimeToken(token), input.paths as string[])
      this.#allow("workspace.read")
      return json(200, { results: results.map(encodeReadResult) })
    }
    if (operation === "write") {
      if (!Array.isArray(input.writes)) return this.#deny("workspace.write", 400)
      const writes = (input.writes as JsonRecord[]).map(decodeWriteInput)
      const results = await this.#workspace.write(this.#runtimeToken(token), writes)
      this.#allow("workspace.write")
      return json(200, { results: results as unknown as JsonRecord[] })
    }
    if (operation === "create") {
      if (!Array.isArray(input.writes)) return this.#deny("workspace.write", 400)
      const creates = (input.writes as JsonRecord[]).map(decodeWriteInput)
      const results = await this.#workspace.create(this.#runtimeToken(token), creates)
      this.#allow("workspace.write")
      return json(200, { results: results as unknown as JsonRecord[] })
    }
    if (operation === "remove") {
      if (!Array.isArray(input.paths)) return this.#deny("workspace.write", 400)
      const results = await this.#workspace.remove(this.#runtimeToken(token), input.paths as string[])
      this.#allow("workspace.write")
      return json(200, { results: results as unknown as JsonRecord[] })
    }
    if (typeof input.from !== "string" || typeof input.to !== "string") return this.#deny("workspace.write", 400)
    const result = await this.#workspace.rename(this.#runtimeToken(token), input.from, input.to)
    this.#allow("workspace.write")
    return json(200, { result: result as unknown as JsonRecord })
  }

  async #fileIndex(request: Request, operation: "list" | "search", principal: Principal): Promise<Response> {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny(`workspace.${operation}`, 400)
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny(`workspace.${operation}.scope`, 403)
    const capabilityResponse = await this.#checkCapability("workspace.read", workspaceId, principal)
    if (capabilityResponse) return capabilityResponse
    const prefix = url.searchParams.get("prefix") ?? "."
    if (operation === "search") {
      const entries = await this.#workspace.search(this.#runtimeToken(token), url.searchParams.get("query") ?? "", prefix)
      this.#allow("workspace.read")
      return json(200, { entries })
    }
    // FUNC-004/C5-1: list is paginated — cursor is opaque and round-tripped
    // via the query string exactly as WorkspacePort.list() returned it.
    const cursor = url.searchParams.get("cursor") ?? undefined
    const page = await this.#workspace.list(this.#runtimeToken(token), prefix, cursor)
    this.#allow("workspace.read")
    return json(200, { entries: page.entries, nextCursor: page.nextCursor, skipped: page.skipped })
  }

  async #designSystems(request: Request, principal: Principal): Promise<Response> {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny("design-system.manifest", 400)
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("design-system.manifest.scope", 403)
    const capabilityResponse = await this.#checkCapability("workspace.read", workspaceId, principal)
    if (capabilityResponse) return capabilityResponse
    let result: FileReadResult | undefined
    try {
      result = (await this.#workspace.read(this.#runtimeToken(token), [WORKSPACE_MANIFEST_PATH]))[0]
    } catch (error) {
      if (isMissingFile(error)) return this.#deny("design-system.manifest.missing", 404)
      throw error
    }
    if (!result) return this.#deny("design-system.manifest.missing", 404)
    try {
      const manifest = parseManifestResult(result.content)
      this.#allow("workspace.read")
      return json(200, manifest as unknown as JsonRecord)
    } catch {
      return this.#deny("design-system.manifest.invalid", 400)
    }
  }

  // P29 — Marketplace plugin routes. The runtime keeps a small in-memory
  // catalogue of installed plugins per workspace. The install is
  // capability-gated; the apply is gated on the `plugin.apply` capability.
  #pluginsByWorkspace = new Map<string, readonly { id: string; name: string; version: string; capabilities: readonly string[] }[]>()

  async #pluginsList(request: Request, principal: Principal): Promise<Response> {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny("plugin.scope", 400)
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("plugin.scope", 403)
    const decision = await this.#checkCapability("workspace.read", workspaceId, principal)
    if (decision) return decision
    const plugins = this.#pluginsByWorkspace.get(workspaceId) ?? []
    this.#allow("workspace.read")
    return json(200, { plugins })
  }

  async #pluginRead(request: Request, pluginId: string, principal: Principal): Promise<Response> {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny("plugin.scope", 400)
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("plugin.scope", 403)
    const decision = await this.#checkCapability("workspace.read", workspaceId, principal)
    if (decision) return decision
    const plugins = this.#pluginsByWorkspace.get(workspaceId) ?? []
    const plugin = plugins.find((p) => p.id === pluginId)
    if (!plugin) return this.#deny("plugin.not-found", 404)
    this.#allow("workspace.read")
    return json(200, plugin as unknown as JsonRecord)
  }

  async #pluginInstall(request: Request, pluginId: string, principal: Principal): Promise<Response> {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny("plugin.scope", 400)
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("plugin.scope", 403)
    const decision = await this.#checkCapability("package.install", workspaceId, principal)
    if (decision) return decision
    const body = await request.json().catch(() => ({})) as { name?: string; version?: string; capabilities?: readonly string[] }
    if (typeof body.name !== "string" || typeof body.version !== "string" || !Array.isArray(body.capabilities)) {
      return this.#deny("plugin.invalid", 400)
    }
    const existing = this.#pluginsByWorkspace.get(workspaceId) ?? []
    const without = existing.filter((p) => p.id !== pluginId)
    this.#pluginsByWorkspace.set(workspaceId, [
      ...without,
      { id: pluginId, name: body.name, version: body.version, capabilities: body.capabilities },
    ])
    this.#allow("package.install")
    return json(200, { ok: true, id: pluginId })
  }

  async #pluginApply(request: Request, pluginId: string, principal: Principal): Promise<Response> {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny("plugin.scope", 400)
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("plugin.scope", 403)
    // The "plugin.apply" capability is a string the runtime registers
    // with the broker at install time. The contracts package only knows
    // the canonical P3 capabilities; plugin-specific capabilities are
    // added by the runtime through the capability broker. The
    // type-cast is intentional and isolated to this one site.
    const applyCapability = "plugin.apply" as never
    const decision = await this.#checkCapability(applyCapability, workspaceId, principal)
    if (decision) return decision
    const plugins = this.#pluginsByWorkspace.get(workspaceId) ?? []
    const plugin = plugins.find((p) => p.id === pluginId)
    if (!plugin) return this.#deny("plugin.not-found", 404)
    this.#allow("plugin.apply")
    return json(200, { ok: true, applied: pluginId })
  }

  async #pluginDelete(request: Request, pluginId: string, principal: Principal): Promise<Response> {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny("plugin.scope", 400)
    const token = this.#authorize(request, workspaceId)
    if (!token) return this.#deny("plugin.scope", 403)
    const decision = await this.#checkCapability("package.install", workspaceId, principal)
    if (decision) return decision
    const existing = this.#pluginsByWorkspace.get(workspaceId) ?? []
    this.#pluginsByWorkspace.set(workspaceId, existing.filter((p) => p.id !== pluginId))
    this.#allow("package.install")
    return json(200, { ok: true })
  }

  async #browserAction(request: Request, action: string, principal: Principal): Promise<Response> {
    if (!this.#browser) return this.#deny("browser.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string") return this.#deny("browser.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("browser.scope", 403)
    const gate = await this.#checkCapability("browser.navigate", input.workspaceId, principal)
    if (gate) return gate
    if (action === "navigate" && typeof input.url === "string") { await this.#browser.navigate(input.workspaceId, input.url); this.#allow("browser.navigate"); return json(202, { accepted: true }) }
    if (action === "snapshot") { const snapshot = await this.#browser.snapshot(input.workspaceId); this.#allow("browser.snapshot"); return json(200, { snapshot }) }
    if (action === "screenshot") { const screenshot = await this.#browser.screenshot(input.workspaceId); this.#allow("browser.screenshot"); return json(200, { contentType: "image/png", data: Buffer.from(screenshot).toString("base64") }) }
    return this.#deny("browser.action", 400)
  }

  async #desktopAction(request: Request, action: string, principal: Principal): Promise<Response> {
    if (!this.#desktop) return this.#deny("desktop.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || typeof input.appId !== "string") return this.#deny("desktop.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("desktop.scope", 403)
    const target = { appId: input.appId, windowId: typeof input.windowId === "string" ? input.windowId : undefined }
    if (action === "observe") { const gate = await this.#checkCapability("desktop.observe", input.workspaceId, principal); if (gate) return gate; const observation = await this.#desktop.observe(target); this.#allow("desktop.observe"); return json(200, { observation }) }
    if (action === "control" && (input.action === "keyboard" || input.action === "mouse")) { const gate = await this.#checkCapability("desktop.control", input.workspaceId, principal); if (gate) return gate; await this.#desktop.control(target, input.action, input.payload); this.#allow("desktop.control"); return json(202, { accepted: true }) }
    return this.#deny("desktop.action", 400)
  }

  async #workflowAction(request: Request, action: string, principal: Principal): Promise<Response> {
    if (!this.#workflow) return this.#deny("workflow.unavailable", 503)
    const input = await body(request)
    if (action === "start") {
      if (typeof input.workspaceId !== "string" || !input.definition || typeof input.definition !== "object") return this.#deny("workflow.start", 400)
      const token = this.#authorize(request, input.workspaceId)
      if (!token) return this.#deny("workflow.scope", 403)
      const gate = await this.#checkCapability("workflow.run", input.workspaceId, principal)
      if (gate) return gate
      const definition = { ...(input.definition as WorkflowDefinition), workspaceId: input.workspaceId }
      const state = await this.#workflow.start(definition)
      this.#workflowOwners.set(state.workflowId, input.workspaceId)
      while (this.#workflowOwners.size > this.#workflowOwnerLimit) {
        const oldest = this.#workflowOwners.keys().next().value
        if (typeof oldest !== "string") break
        this.#workflowOwners.delete(oldest)
      }
      this.#allow("workflow.start")
      return json(202, { state })
    }
    if (typeof input.workflowId !== "string") return this.#deny("workflow.scope", 400)
    const workspaceId = this.#workflowOwners.get(input.workflowId)
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("workflow.scope", 403)
    const state = action === "resume" ? await this.#workflow.resume(input.workflowId) : action === "cancel" ? await this.#workflow.cancel(input.workflowId) : undefined
    if (!state) return this.#deny("workflow.action", 400)
    if (action === "cancel" || state.status === "completed" || state.status === "failed" || state.status === "cancelled") this.#workflowOwners.delete(input.workflowId)
    this.#allow(`workflow.${action}`)
    return json(200, { state })
  }

  async #memoryAction(request: Request, action: string, principal: Principal): Promise<Response> {
    if (!this.#memory) return this.#deny("memory.unavailable", 503)
    const input = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams.entries()) : await body(request)
    if (typeof input.workspaceId !== "string") return this.#deny("memory.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("memory.scope", 403)
    if (request.method === "POST" && action === "remember") { const gate = await this.#checkCapability("workspace.write", input.workspaceId, principal); if (gate) return gate; if (typeof input.content !== "string" || (input.source !== "user" && input.source !== "agent" && input.source !== "import")) return this.#deny("memory.remember", 400); const record = await this.#memory.remember({ workspaceId: input.workspaceId, content: input.content, source: input.source, tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : undefined, id: typeof input.id === "string" ? input.id : undefined }); this.#allow("memory.remember"); return json(201, { record }) }
    if (request.method === "GET" && action === "search") { const gate = await this.#checkCapability("workspace.read", input.workspaceId, principal); if (gate) return gate; const records = await this.#memory.search({ workspaceId: input.workspaceId, text: typeof input.text === "string" ? input.text : undefined }); this.#allow("memory.search"); return json(200, { records }) }
    if (request.method === "DELETE" && action === "remove" && typeof input.id === "string") { const gate = await this.#checkCapability("workspace.write", input.workspaceId, principal); if (gate) return gate; const removed = await this.#memory.remove(input.workspaceId, input.id); this.#allow("memory.remove"); return json(200, { removed }) }
    return this.#deny("memory.action", 400)
  }

  async #capabilityAction(request: Request, action: string, principal: Principal): Promise<Response> {
    if (!this.#capabilities) return this.#deny("capability.unavailable", 503)
    const input = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams.entries()) : await body(request)
    if (typeof input.workspaceId !== "string") return this.#deny("capability.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("capability.scope", 403)
    const gate = await this.#checkCapability("package.install", input.workspaceId, principal)
    if (gate) return gate
    if (action === "register" && input.manifest && typeof input.manifest === "object") { this.#capabilities.register(input.manifest as CapabilityManifest); this.#allow("capability.register"); return json(201, { registered: true }) }
    if (action === "approve" && typeof input.digest === "string") { this.#capabilities.approve(input.digest); this.#allow("capability.approve"); return json(200, { approved: true }) }
    if (action === "enable" && typeof input.digest === "string") { this.#capabilities.enable(input.digest); this.#allow("capability.enable"); return json(200, { enabled: true }) }
    if (action === "revoke" && typeof input.digest === "string") { this.#capabilities.revoke(input.digest); this.#allow("capability.revoke"); return json(200, { revoked: true }) }
    if (action === "search") { const records = this.#capabilities.search({ tag: typeof input.tag === "string" ? input.tag : undefined, trustLevel: typeof input.trustLevel === "string" ? input.trustLevel as "untrusted" | "verified" | "official" : undefined, enabledOnly: input.enabledOnly === "true" }); this.#allow("capability.search"); return json(200, { records }) }
    return this.#deny("capability.action", 400)
  }

  async #uiAction(request: Request, principal: Principal): Promise<Response> {
    if (!this.#ui) return this.#deny("ui.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || !input.action || typeof input.action !== "object") return this.#deny("ui.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("ui.scope", 403)
    const gate = await this.#checkCapability("desktop.control", input.workspaceId, principal)
    if (gate) return gate
    const result = await this.#ui.execute(input.action as UiAction)
    this.#allow("ui.action")
    return json(result.status === "denied" ? 403 : result.status === "pending-approval" ? 202 : 200, { result })
  }

  async #renderUi(request: Request): Promise<Response> {
    if (!this.#uiAllowedActions) return this.#deny("ui.render.unavailable", 503)
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || !input.node || typeof input.node !== "object" || Array.isArray(input.node)) return this.#deny("ui.render", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("ui.render.scope", 403)
    try {
      const rendered = renderGenerativeUi(input.node as UiNode, this.#uiAllowedActions)
      this.#allow("ui.render")
      return json(200, { rendered })
    } catch {
      return this.#deny("ui.render", 400)
    }
  }

  async #skillHubAction(request: Request, action: string): Promise<Response> {
    if (!this.#skillHub) return this.#deny("skill-hub.unavailable", 503)
    const input = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams.entries()) : await body(request)
    if (typeof input.workspaceId !== "string") return this.#deny("skill-hub.scope", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("skill-hub.scope", 403)
    if (action === "search") {
      const query = typeof input.query === "string" ? input.query : undefined
      const tags = typeof input.tags === "string" && input.tags.length > 0 ? input.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0) : Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : undefined
      const trust = input.trust === "untrusted" || input.trust === "verified" || input.trust === "official" ? input.trust : undefined
      const manifests = await this.#skillHub.search({ query, tags, trust })
      this.#allow("skill-hub.search")
      return json(200, { manifests })
    }
    if (action === "install") {
      if (typeof input.digest !== "string") return this.#deny("skill-hub.install", 400)
      const installed = await this.#skillHub.install(input.digest)
      this.#allow("skill-hub.install")
      return json(201, { installed })
    }
    if (action === "update") {
      if (typeof input.name !== "string") return this.#deny("skill-hub.update", 400)
      const updated = await this.#skillHub.update(input.name)
      this.#allow("skill-hub.update")
      return json(200, { updated: updated ?? null })
    }
    return this.#deny("skill-hub.action", 400)
  }

  async #designSkillsAction(request: Request, principal: Principal): Promise<Response> {
    if (!this.#designSkills) return this.#deny("design-skills.unavailable", 503)
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId) return this.#deny("design-skills.scope", 400)
    if (!this.#authorize(request, workspaceId)) return this.#deny("design-skills.scope", 403)
    const gate = await this.#checkCapability("workspace.read", workspaceId, principal)
    if (gate) return gate
    const skills = await this.#designSkills(workspaceId)
    this.#allow("design-skills.list")
    return json(200, { skills })
  }

  // status is a read; every other action mutates stored credentials for the
  // account, so it carries the same capability as any other workspace write.
  async #githubAction(request: Request, action: string, principal: Principal): Promise<Response> {
    if (!this.#github) return this.#deny("github.unavailable", 503)
    // GET carries no body: githubStatus() sends the workspace in the query
    // string, so reading input.workspaceId here refused every status call.
    const workspaceId = request.method === "GET" ? new URL(request.url).searchParams.get("workspaceId") : (await body(request)).workspaceId
    if (typeof workspaceId !== "string" || !this.#authorize(request, workspaceId)) return this.#deny("github.scope", 403)
    if (action !== "status" && action !== "start" && action !== "poll" && action !== "cancel" && action !== "disconnect") return this.#deny("github.action", 400)
    const gate = await this.#checkCapability(action === "status" ? "workspace.read" : "workspace.write", workspaceId, principal)
    if (gate) return gate
    if (action === "status") return json(200, await this.#github.status(workspaceId))
    if (action === "start") return json(200, await this.#github.deviceStart(workspaceId))
    if (action === "poll") return json(200, await this.#github.devicePoll(workspaceId))
    if (action === "cancel") return json(200, await this.#github.deviceCancel(workspaceId))
    return json(200, await this.#github.disconnect(workspaceId))
  }

  async #approval(request: Request, id: string): Promise<Response> {
    const token = this.#bearer(request)
    const approval = token ? this.#capability.getApproval?.(id) : undefined
    if (!token || !approval || this.#tokens.get(token)?.id !== approval.resource) return this.#deny("approval.scope", 403)
    if (request.method === "DELETE") {
      const decision = this.#capability.cancel?.(id)
      if (!decision) return this.#deny("approval.cancel", 404)
      this.#audit.record("workbench-server", "approval.cancel", "deny")
      return json(200, { decision })
    }
    const input = await body(request)
    if (input.decision !== "allow" && input.decision !== "deny") return this.#deny("approval.resolve", 400)
    const decision = this.#capability.resolve?.(id, input.decision, "file-session", approval.resource)
    if (!decision) return this.#deny("approval.resolve", 404)
    this.#audit.record("workbench-server", "approval.resolve", (decision as { kind?: string }).kind === "allow" ? "allow" : "deny")
    return json(200, { decision })
  }
  async #approvalList(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")
    const token = workspaceId ? this.#authorize(request, workspaceId) : undefined
    if (!workspaceId || !token) return this.#deny("approval.list.scope", 403)
    const approvals = this.#capability.listApprovals?.(workspaceId)
    if (!approvals) return this.#deny("approval.list.unavailable", 503)
    this.#allow("approval.list")
    return json(200, { approvals })
  }
  async #auditPage(request: Request, kind: "trace" | "activity"): Promise<Response> {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny(`${kind}.scope`, 403)
    const after = Number(url.searchParams.get("after") ?? "0")
    const requestedLimit = Number(url.searchParams.get("limit") ?? "50")
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50
    const page = this.#audit.page?.(Number.isSafeInteger(after) && after > 0 ? after : 0, limit)
    if (!page) return this.#deny(`${kind}.unavailable`, 503)
    this.#allow(`${kind}.read`)
    return json(200, { kind, ...page })
  }
  #artifactsFor(workspaceId: string): ArtifactStore | undefined {
    const artifacts = this.#artifacts
    if (!artifacts) return undefined
    return typeof artifacts === "function" ? artifacts(workspaceId) : artifacts
  }

  async #artifactRead(request: Request, artifactId: string | undefined, principal: Principal): Promise<Response> {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("artifact.read.scope", 403)
    const artifacts = this.#artifactsFor(workspaceId)
    if (!artifacts) return this.#deny("artifact.read.unavailable", 503)
    const gate = await this.#checkCapability("workspace.read", workspaceId, principal)
    if (gate) return gate
    if (!artifactId) { this.#allow("artifact.list"); return json(200, { artifacts: await artifacts.list() }) }
    const artifact = await artifacts.latest(artifactId)
    if (!artifact) return this.#deny("artifact.not-found", 404)
    const content = await artifacts.read(artifact)
    this.#allow("artifact.read")
    return json(200, { artifact, content: Buffer.from(content).toString("base64"), encoding: "base64" })
  }

  /**
   * P10 raw artifact read. Returns the raw bytes of a single artifact's
   * file (with Content-Type derived from the requested path's extension)
   * so the sandboxed iframe in P11 can mount agent-authored HTML
   * without the host ever reading the bytes through `contentDocument`.
   *
   * Security, in order of checks:
   *  1. path shape: no `..`, no leading `/` or `\`, no Windows drive
   *     letter, no NUL — anything that would let the caller escape
   *     the artifact directory.
   *  2. workspace authorization and broker capability `artifact.preview`.
   *  3. artifact existence: a missing artifact yields the same 403
   *     as a path mismatch, so a caller cannot probe for artifact IDs
   *     they do not already have a token for.
   *  4. path within the artifact: the request path must match the
   *     artifact's filename (single-file model). Bundles are a
   *     future concern; the same `403 on mismatch` rule still
   *     applies.
   *  5. CSP for HTML responses (defense in depth — also catches the
   *     "save to disk, open in a regular browser" attack path).
   */
  async #artifactRaw(request: Request, artifactId: string | undefined, rawPath: string | undefined, principal: Principal): Promise<Response> {
    if (!artifactId) return this.#deny("artifact.raw.id", 400)
    if (!rawPath) return this.#deny("artifact.raw.path", 400)
    if (rawPath.includes("..") || rawPath.startsWith("/") || rawPath.startsWith("\\") || /^[A-Za-z]:/.test(rawPath) || rawPath.includes("\0")) {
      return this.#deny("artifact.raw.path-escape", 403)
    }
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("artifact.raw.scope", 403)
    const artifacts = this.#artifactsFor(workspaceId)
    if (!artifacts) return this.#deny("artifact.raw.unavailable", 503)
    const gate = await this.#checkCapability("artifact.preview", workspaceId, principal)
    if (gate) return gate
    const artifact = await artifacts.latest(artifactId)
    if (!artifact) return this.#deny("artifact.raw.path", 403)
    const artifactFileName = basename(artifact.relativePath)
    if (rawPath !== artifactFileName && rawPath !== artifact.relativePath) return this.#deny("artifact.raw.path", 403)
    const content = await artifacts.read(artifact)
    const lower = rawPath.toLowerCase()
    const lastDot = lower.lastIndexOf(".")
    const ext = lastDot >= 0 ? lower.slice(lastDot + 1) : ""
    const knownType = Object.hasOwn(ARTIFACT_RAW_CONTENT_TYPES, ext) ? ARTIFACT_RAW_CONTENT_TYPES[ext]! : null
    const contentType = knownType ?? "application/octet-stream"
    const disposition = knownType ? "inline" : "attachment"
    const headers: Record<string, string> = {
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      "content-disposition": `${disposition}; filename="${rawPath.replace(/"/g, "")}"`,
    }
    if (ext === "html" || ext === "htm") {
      headers["content-security-policy"] = ARTIFACT_RAW_CSP
    }
    this.#allow("artifact.preview")
    return new Response(new Blob([new Uint8Array(content)]), { status: 200, headers })
  }
  /**
   * Phase 9.4 — mints a signed, short-lived link to `#artifactPresent`
   * below. Authenticated and capability-gated exactly like
   * `#artifactExport` ("même famille" — the plan's own wording): the
   * caller must already hold `artifact.export` for this workspace. The
   * minted link itself carries no such requirement — that's the whole
   * point, it's what lets it be opened by someone else.
   */
  async #artifactPresentLink(request: Request, artifactId: string | undefined, principal: Principal): Promise<Response> {
    if (!this.#presentLinks) return this.#deny("artifact.present.unconfigured", 503)
    if (!artifactId) return this.#deny("artifact.present.id", 400)
    const input = await body(request)
    if (typeof input.workspaceId !== "string") return this.#deny("artifact.present", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("artifact.present.scope", 403)
    const artifacts = this.#artifactsFor(input.workspaceId)
    if (!artifacts) return this.#deny("artifact.present.unavailable", 503)
    const gate = await this.#checkCapability("artifact.export", input.workspaceId, principal)
    if (gate) return gate
    const artifact = await artifacts.latest(artifactId)
    if (!artifact) return this.#deny("artifact.present.missing", 404)
    const { token: linkToken, expiresAt } = this.#presentLinks.sign(artifactId, input.workspaceId)
    const origin = new URL(request.url).origin
    this.#allow("artifact.export")
    return json(200, { url: `${origin}/v1/artifacts/${encodeURIComponent(artifactId)}/present?token=${encodeURIComponent(linkToken)}`, expiresAt })
  }

  /**
   * Phase 9.4 — serves the raw artifact for a valid present-link token.
   * Deliberately reachable with NO principal (see `#route`'s early
   * dispatch for this path, before the universal auth gate): the whole
   * point of a present link is that the recipient never authenticated
   * with this server. The signed, single-artifact, short-lived token
   * verified below is the only access control this route has — and is
   * meant to be the only one it needs.
   */
  async #artifactPresent(request: Request, artifactId: string | undefined): Promise<Response> {
    if (!this.#presentLinks) return this.#deny("artifact.present.unconfigured", 503)
    if (!artifactId) return this.#deny("artifact.present.id", 400)
    const suppliedToken = new URL(request.url).searchParams.get("token")
    if (!suppliedToken) return this.#deny("artifact.present.token", 400)
    const claims = this.#presentLinks.verify(suppliedToken)
    if (!claims || claims.artifactId !== artifactId) return this.#deny("artifact.present.token", 403)
    // The workspace comes from the signed claims, so the link reaches exactly
    // the lineage it was minted against and no other.
    const artifacts = this.#artifactsFor(claims.workspaceId)
    if (!artifacts) return this.#deny("artifact.present.unavailable", 503)
    const artifact = await artifacts.latest(artifactId)
    if (!artifact) return this.#deny("artifact.present.missing", 404)
    const content = await artifacts.read(artifact)
    this.#allow("artifact.present")
    return new Response(new Blob([new Uint8Array(content)]), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "content-security-policy": ARTIFACT_RAW_CSP },
    })
  }

  async #artifactHistory(request: Request, artifactId: string | undefined, principal: Principal): Promise<Response> {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("artifact.history.scope", 403)
    const artifacts = this.#artifactsFor(workspaceId)
    if (!artifacts) return this.#deny("artifact.history.unavailable", 503)
    const gate = await this.#checkCapability("workspace.read", workspaceId, principal)
    if (gate) return gate
    if (!artifactId) return this.#deny("artifact.history.id", 400)
    this.#allow("artifact.history")
    return json(200, { history: await artifacts.history(artifactId) })
  }
  async #artifactWrite(request: Request, principal: Principal): Promise<Response> {
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || typeof input.kind !== "string" || typeof input.filename !== "string" || typeof input.content !== "string") return this.#deny("artifact.create", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("artifact.create.scope", 403)
    const artifacts = this.#artifactsFor(input.workspaceId)
    if (!artifacts) return this.#deny("artifact.create.unavailable", 503)
    const gate = await this.#checkCapability("artifact.create", input.workspaceId, principal)
    if (gate) return gate
    const artifact = await artifacts.create({ kind: input.kind as Parameters<ArtifactStore["create"]>[0]["kind"], filename: input.filename, content: input.content, artifactId: typeof input.artifactId === "string" ? input.artifactId : undefined, metadata: input.metadata as Record<string, string> | undefined, provenance: input.provenance as Parameters<ArtifactStore["create"]>[0]["provenance"] })
    this.#allow("artifact.create")
    return json(201, { artifact })
  }
  async #artifactExport(request: Request, principal: Principal): Promise<Response> {
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || typeof input.artifactId !== "string") return this.#deny("artifact.export", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("artifact.export.scope", 403)
    const artifacts = this.#artifactsFor(input.workspaceId)
    if (!artifacts) return this.#deny("artifact.export.unavailable", 503)
    const gate = await this.#checkCapability("artifact.export", input.workspaceId, principal)
    if (gate) return gate
    const artifact = await artifacts.latest(input.artifactId)
    if (!artifact) return this.#deny("artifact.export.not-found", 404)
    const exported = await artifacts.export(artifact, { outbox: typeof input.outbox === "string" ? input.outbox : undefined, metadata: input.metadata === "keep" ? "keep" : "strip" })
    this.#allow("artifact.export")
    return json(200, { exported })
  }
  async #documents(request: Request, principal: Principal): Promise<Response> {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")
    if (!workspaceId || !this.#authorize(request, workspaceId)) return this.#deny("documents.scope", 403)
    const artifacts = this.#artifactsFor(workspaceId)
    if (!artifacts) return this.#deny("documents.unavailable", 503)
    const gate = await this.#checkCapability("workspace.read", workspaceId, principal)
    if (gate) return gate
    const documents = (await artifacts.list()).filter((artifact) => artifact.kind !== "binary")
    this.#allow("documents.list")
    return json(200, { documents })
  }
  async #specValidate(request: Request, principal: Principal): Promise<Response> {
    const input = await body(request)
    if (typeof input.workspaceId !== "string" || (typeof input.spec !== "string" && (!input.spec || typeof input.spec !== "object"))) return this.#deny("spec.validate", 400)
    const token = this.#authorize(request, input.workspaceId)
    if (!token) return this.#deny("spec.validate.scope", 403)
    const gate = await this.#checkCapability("workspace.read", input.workspaceId, principal)
    if (gate) return gate
    const spec = parseSpec(input.spec)
    const resolution = resolveEffectiveCapabilities(spec, [])
    this.#allow("spec.validate")
    return json(200, { valid: true, spec, capabilities: resolution })
  }
  async #closeFileSession(request: Request, token: string): Promise<Response> {
    const supplied = this.#bearer(request)
    if (!supplied || supplied !== token || !this.#tokens.has(token)) return this.#deny("workspace.close.scope", 403)
    await this.#workspace.close(this.#runtimeToken(token))
    this.#runtimeTokens.delete(token)
    this.#tokens.delete(token)
    this.#allow("workspace.close")
    return json(200, { closed: true })
  }

  /**
   * Closes every open file session.
   *
   * WHY it swallows per-token failures: shutdown must release as many sessions
   * as it can. One workspace whose root already vanished must not leave the
   * others holding watchers. The failures are returned so a caller can report
   * them rather than discover them silently.
   */
  async shutdown(): Promise<readonly string[]> {
    const failures: string[] = []
    for (const token of [...this.#tokens.keys()]) {
      try {
        await this.#workspace.close(this.#runtimeToken(token))
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "close failed")
      }
      this.#tokens.delete(token)
      this.#runtimeTokens.delete(token)
    }
    this.#audit.record("workbench-server", "workspace.shutdown", failures.length === 0 ? "allow" : "deny")
    return failures
  }

  /** Number of file sessions currently open. Exposed for shutdown assertions. */
  get openFileSessions(): number {
    return this.#tokens.size
  }

  #runtimeToken(token: string): string {
    return this.#runtimeTokens.get(token) ?? token
  }

  get instanceId(): string {
    return this.#instanceId
  }

  #authorize(request: Request, workspaceId: string): string | undefined {
    const token = this.#bearer(request)
    const handle = token ? this.#tokens.get(token) : undefined
    return handle?.id === workspaceId ? token : undefined
  }

  /**
   * Reads the file-session token, which is a capability handle and NOT the
   * caller's identity — identity lives in `Authorization` and is resolved by
   * the PrincipalAuthenticator.
   *
   * WHY the Authorization fallback: callers that predate principal
   * authentication carry the file-session token in `Authorization: Bearer`.
   * The fallback is safe because the value is only ever looked up in #tokens —
   * a principal token is never present there, so a misrouted credential fails
   * closed with 403 rather than granting access.
   */
  #bearer(request: Request): string | undefined {
    const scoped = request.headers.get("x-unifia-file-session")
    if (scoped) return scoped
    const value = request.headers.get("authorization")
    if (value?.startsWith("Bearer ")) return value.slice(7)
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return undefined
    const protocols = request.headers.get("sec-websocket-protocol")?.split(",").map((part) => part.trim()) ?? []
    const index = protocols.indexOf("bearer")
    return index >= 0 ? protocols[index + 1] : undefined
  }

  /**
   * SEC-001: the principal's own granted scopes (built from
   * ScopedTokenRequest.capabilities at #authenticate) are checked FIRST,
   * before the injected CapabilityGate ever runs. Before this fix, a token
   * scoped to ["workspace.read", "workspace.watch"] could still reach the
   * gate for "workflow.run" and get 202 approvalRequired — the gate's
   * server-wide allowlist has no idea what was actually granted to the
   * calling token. A capability the token was never issued must fail
   * closed at 403 without ever creating an approval — UNLESS the
   * capability is step-up eligible (STEP_UP_ELIGIBLE_CAPABILITIES): the
   * base connection lease only ever carries workspace.read/watch (see
   * READ_CAPABILITIES in provider.tsx), so artifact.create/export — real
   * operations Design/Work trigger — must still be able to reach the
   * approval gate below, or "saved"/"exported" break outright instead of
   * asking for confirmation. Every other capability (workspace.write,
   * workflow.run, desktop.control/observe, browser.navigate,
   * package.install) has no legitimate caller in this branch and is
   * refused before the gate runs, so it can never create an approval
   * either — see 2026-08-17 decision, capability-scope.test.ts.
   */
  async #checkCapability(capability: P3Capability, resource: string, principal: Principal): Promise<Response | undefined> {
    if (!principal.scopes.has(capability) && !STEP_UP_ELIGIBLE_CAPABILITIES.has(capability)) return this.#deny(capability, 403)
    const decision = await this.#capability.check(capability, resource, "workbench-server")
    if (decision === "allow") return undefined
    if (typeof decision === "object") {
      this.#audit.record("workbench-server", capability, "approval_required")
      return json(202, { approvalRequired: true, approvalId: decision.approvalId, capability })
    }
    return this.#deny(capability, 403)
  }

  #allow(capability: string): void { this.#audit.record("workbench-server", capability, "allow") }
  #deny(capability: string, status: number): Response { this.#audit.record("workbench-server", capability, "deny"); return json(status, { error: "denied", capability }) }
}

/** How long a granted decision stays honored before a sensitive operation needs re-approval (C2-5/D-2). Distinct from ttlMs, which only bounds the pending window. */
const DEFAULT_GRANT_TTL_MS = 5 * 60_000

export class ApprovalCapabilityGate implements CapabilityGate {
  readonly #broker: ApprovalBroker
  readonly #allowlisted: ReadonlySet<P3Capability>
  readonly #ttlMs: number
  readonly #grantTtlMs: number
  readonly #now: () => number
  constructor(broker: ApprovalBroker, allowlisted: ReadonlySet<P3Capability> = new Set(), ttlMs = 30_000, grantTtlMs = DEFAULT_GRANT_TTL_MS, now: () => number = Date.now) {
    this.#broker = broker
    this.#allowlisted = allowlisted
    this.#ttlMs = ttlMs
    this.#grantTtlMs = grantTtlMs
    this.#now = now
  }
  async check(capability: P3Capability, resource: string, _actor: string): Promise<CapabilityDecision> {
    if (this.#allowlisted.has(capability)) return "allow"
    const existing = this.#broker.find(capability, resource)
    // C2-5/D-2: a granted decision only stays honored for grantTtlMs from
    // when it was resolved — otherwise one approval would authorize the
    // capability for the rest of the session, defeating step-up (C2-3).
    // An expired grant falls through to request a fresh approval, same as
    // if none had ever existed.
    if (existing?.status === "allow" && existing.resolvedAt !== undefined && this.#now() - existing.resolvedAt < this.#grantTtlMs) return "allow"
    if (existing?.status === "pending") return { kind: "approval_required", approvalId: existing.id }
    const request = this.#broker.request(capability, resource, this.#now() + this.#ttlMs)
    return { kind: "approval_required", approvalId: request.id }
  }
  getApproval(id: string) { return this.#broker.get(id) }
  listApprovals(resource: string) { return this.#broker.pending(resource) }
  resolve(id: string, decision: "allow" | "deny", actor: string, grantedResource?: string) { return this.#broker.resolve(id, decision, actor, grantedResource) }
  cancel(id: string) { return this.#broker.cancel(id) }
}
