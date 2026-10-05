/* SPDX-License-Identifier: MIT */
/**
 * Browser session routes (issue #118): session, tab, observation, action,
 * input, upload and download endpoints over the BrowserSessionManager.
 * Every route is workspace-scoped and passes the browser.* capability gate.
 */
import type { Principal } from "../auth.js"
import { body, json } from "../http.js"
import type { ServerContext } from "../server-context.js"
import { BrowserControllerSchema, BrowserHistoryActionSchema, BrowserInteractionActionSchema, BrowserRuntimeProfileSchema, BrowserUploadInputSchema, BrowserViewportInputSchema, BrowserViewportSchema, MAX_BROWSER_UPLOAD_BYTES, MAX_BROWSER_UPLOAD_REQUEST_BYTES, type BrowserSession } from "@unifia/contracts"
import type { P3Capability } from "@unifia/contracts"

export async function browserSessionAction(
  ctx: ServerContext,
  request: Request,
  action: string,
  sessionId: string | undefined,
  tabId: string | undefined,
  principal: Principal,
): Promise<Response> {
  if (!ctx.browserSessions) return ctx.deny(principal, "browser.session.unavailable", 503)
  const url = new URL(request.url)
  let input: Record<string, unknown>
  if (request.method === "GET") input = { workspaceId: url.searchParams.get("workspaceId") }
  else if (action === "upload") {
    try { input = await readBrowserUploadBody(request) }
    catch (error) {
      const status = error instanceof BrowserUploadBodyTooLargeError ? 413 : 400
      return ctx.deny(principal, "browser.upload.body", status)
    }
  } else input = await body(request)
  if (typeof input.workspaceId !== "string") return ctx.deny(principal, "browser.session.scope", 400, { reason: "missing-workspace-id" })
  if (!ctx.authorize(request, input.workspaceId)) return ctx.deny(principal, "browser.session.scope", 403, { resource: input.workspaceId })
  const capability = capabilityForBrowserAction(action)
  const gate = await ctx.checkCapability(capability, input.workspaceId, principal)
  if (gate) return gate
  if (action === "create" && request.method === "POST") return createBrowserSession(ctx, input, principal)
  if (!sessionId) return ctx.deny(principal, "browser.session.route", 400)
  let session: BrowserSession
  try {
    session = ctx.browserSessions.get(sessionId)
  } catch {
    // WHY: a missing session and one owned by another workspace share one response to prevent id probing.
    return ctx.deny(principal, "browser.session.missing", 404)
  }
  if (session.workspaceId !== input.workspaceId) return ctx.deny(principal, "browser.session.missing", 404)
  ctx.browserSessions.bindCapabilities?.(sessionId, [...principal.scopes].filter((scope): scope is P3Capability => scope.startsWith("browser.")))
  return browserSessionOperation(ctx, request, action, session, sessionId, tabId, input, principal)
}

function createBrowserSession(ctx: ServerContext, input: Record<string, unknown>, principal: Principal): Response {
  const workspaceId = input.workspaceId as string
  const capabilities = [...principal.scopes].filter((scope): scope is P3Capability => scope.startsWith("browser."))
  const session = ctx.browserSessions?.create({
    workspaceId,
    chatSessionId: typeof input.chatSessionId === "string" ? input.chatSessionId : undefined,
    runtimeProfile: BrowserRuntimeProfileSchema.parse(input.runtimeProfile),
    viewport: BrowserViewportSchema.parse(input.viewport),
    capabilities,
  })
  if (!session) return ctx.deny(principal, "browser.session.unavailable", 503)
  ctx.browserSessions?.bindCapabilities?.(session.id, capabilities)
  ctx.allow(principal, "browser.session.create", { resource: workspaceId, authorizingCapability: "browser.navigate" })
  return json(201, { session })
}

function browserSessionOperation(
  ctx: ServerContext,
  request: Request,
  action: string,
  session: BrowserSession,
  sessionId: string,
  tabId: string | undefined,
  input: Record<string, unknown>,
  principal: Principal,
): Promise<Response> | Response {
  const service = ctx.browserSessions
  const capability = capabilityForBrowserAction(action)
  if (!service) return ctx.deny(principal, "browser.session.unavailable", 503)
  if (action === "read" && request.method === "GET") {
    ctx.allow(principal, "browser.session.read", { resource: sessionId, authorizingCapability: capability })
    return json(200, { session })
  }
  if (action === "activity" && request.method === "GET") {
    const after = Number(new URL(request.url).searchParams.get("after") ?? "0")
    if (!Number.isSafeInteger(after) || after < 0) return ctx.deny(principal, "browser.activity.cursor", 400)
    const events = service.activity(sessionId, after)
    ctx.allow(principal, "browser.activity.read", { resource: sessionId, authorizingCapability: capability })
    return json(200, { events })
  }
  if (action === "downloads" && request.method === "GET") {
    ctx.allow(principal, "browser.downloads.read", { resource: sessionId, authorizingCapability: capability })
    return json(200, { downloads: service.downloads(sessionId) })
  }
  if (action === "close" && request.method === "DELETE") {
    return service.close(sessionId).then(() => {
      ctx.allow(principal, "browser.session.close", { resource: session.workspaceId, authorizingCapability: capability })
      return json(200, { closed: true })
    })
  }
  if (action === "tab-create" && request.method === "POST") {
    return service.openTab(sessionId, typeof input.url === "string" ? input.url : undefined).then((updated) => {
      ctx.allow(principal, "browser.tab.create", { resource: sessionId, authorizingCapability: capability })
      return json(201, { session: updated })
    })
  }
  if (action === "control" && request.method === "POST") {
    const controller = BrowserControllerSchema.parse(input.controller)
    return service.takeControl(sessionId, controller).then((updated) => {
      ctx.allow(principal, "browser.controller.change", { resource: sessionId, authorizingCapability: capability })
      return json(200, { session: updated })
    })
  }
  if (action === "viewport" && request.method === "POST") {
    const viewport = BrowserViewportSchema.parse(input.viewport)
    return service.resizeViewport(sessionId, viewport).then((updated) => {
      ctx.allow(principal, "browser.viewport.resize", { resource: sessionId, authorizingCapability: capability })
      return json(200, { session: updated })
    })
  }
  if (action === "download-release" && request.method === "POST" && tabId) {
    return service.releaseDownload(sessionId, tabId).then((download) => {
      ctx.allow(principal, "browser.download.release", { resource: sessionId, authorizingCapability: capability })
      return json(200, { download })
    })
  }
  if (!tabId) return ctx.deny(principal, "browser.tab.route", 400)
  return browserTabAction(ctx, request, action, session, sessionId, tabId, input, principal)
}

function browserTabAction(
  ctx: ServerContext,
  request: Request,
  action: string,
  session: BrowserSession,
  sessionId: string,
  tabId: string,
  input: Record<string, unknown>,
  principal: Principal,
): Promise<Response> | Response {
  const service = ctx.browserSessions
  const capability = capabilityForBrowserAction(action)
  if (!service) return ctx.deny(principal, "browser.session.unavailable", 503)
  if (action === "tab-navigate" && request.method === "POST" && typeof input.url === "string") {
    return service.navigate(sessionId, tabId, input.url, "user").then((updated) => {
      ctx.allow(principal, "browser.navigate", { resource: sessionId, authorizingCapability: capability })
      return json(200, { session: updated })
    })
  }
  if (action === "tab-history" && request.method === "POST") {
    const historyAction = BrowserHistoryActionSchema.parse(input.action)
    return service.history(sessionId, tabId, historyAction).then((updated) => {
      ctx.allow(principal, `browser.history.${historyAction}`, { resource: sessionId, authorizingCapability: capability })
      return json(200, { session: updated })
    })
  }
  if (action === "tab-state" && request.method === "GET") {
    return service.refreshTab(sessionId, tabId).then((updated) => {
      ctx.allow(principal, "browser.tab.state", { resource: sessionId, authorizingCapability: capability })
      return json(200, { session: updated })
    })
  }
  if (action === "tab-select" && request.method === "POST") {
    return service.selectTab(sessionId, tabId).then((updated) => {
      ctx.allow(principal, "browser.tab.select", { resource: sessionId, authorizingCapability: capability })
      return json(200, { session: updated })
    })
  }
  if (action === "tab-close" && request.method === "DELETE") {
    return service.closeTab(sessionId, tabId).then((updated) => {
      ctx.allow(principal, "browser.tab.close", { resource: sessionId, authorizingCapability: capability })
      return json(200, { session: updated })
    })
  }
  if (action === "observe" && request.method === "POST") {
    return service.observe(sessionId, tabId).then((observation) => {
      ctx.allow(principal, "browser.observe", { resource: sessionId, authorizingCapability: capability })
      return json(200, observation)
    })
  }
  if (action === "screenshot" && request.method === "GET") {
    return service.screenshot(sessionId, tabId).then((bytes) => {
      ctx.allow(principal, "browser.viewport.screenshot", { resource: sessionId, authorizingCapability: capability })
      return json(200, { contentType: "image/png", data: Buffer.from(bytes).toString("base64") })
    })
  }
  if (action === "input" && request.method === "POST") {
    return service.input(sessionId, tabId, BrowserViewportInputSchema.parse(input.action)).then(() => {
      ctx.allow(principal, "browser.viewport.input", { resource: sessionId, authorizingCapability: capability })
      return json(202, { accepted: true })
    })
  }
  if (action === "upload" && request.method === "POST") {
    const upload = BrowserUploadInputSchema.parse(input.upload)
    const bytes = Buffer.from(upload.base64, "base64")
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BROWSER_UPLOAD_BYTES || bytes.toString("base64") !== upload.base64) {
      return ctx.deny(principal, "browser.upload.content", 400, { resource: sessionId })
    }
    return service.upload(sessionId, tabId, { name: upload.name, mediaType: upload.mediaType, bytes }).then(() => {
      ctx.allow(principal, "browser.upload", { resource: sessionId, authorizingCapability: capability })
      return json(202, { accepted: true })
    })
  }
  if (action === "act" && request.method === "POST") {
    const observationId = String(input.observationId ?? "")
    const browserAction = BrowserInteractionActionSchema.parse(input.action)
    return service.act(sessionId, tabId, observationId, browserAction).then(() => {
      ctx.allow(principal, "browser.act", { resource: sessionId, authorizingCapability: capability })
      return json(202, { accepted: true })
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "BrowserActionApprovalRequiredError") {
        return ctx.deny(principal, "browser.action.approval-required", 403, { resource: sessionId, reason: "sensitive-action" })
      }
      throw error
    })
  }
  return ctx.deny(principal, "browser.session.action", 400, { resource: session.workspaceId })
}

function capabilityForBrowserAction(action: string): P3Capability {
  if (action === "observe" || action === "activity" || action === "downloads" || action === "screenshot" || action === "read" || action === "tab-state") return "browser.observe"
  if (action === "download-release") return "browser.download"
  if (action === "upload") return "browser.upload"
  if (action === "input" || action === "act") return "browser.interact"
  if (action === "control" || action === "viewport" || action === "tab-select" || action === "tab-close" || action === "close" || action === "tab-history") return "browser.control"
  return "browser.navigate"
}

class BrowserUploadBodyTooLargeError extends Error {}

async function readBrowserUploadBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length"))
  if (Number.isFinite(length) && length > MAX_BROWSER_UPLOAD_REQUEST_BYTES) throw new BrowserUploadBodyTooLargeError()
  if (!request.body) throw new Error("missing request body")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_BROWSER_UPLOAD_REQUEST_BYTES) {
        await reader.cancel()
        throw new BrowserUploadBodyTooLargeError()
      }
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid upload body")
  return value as Record<string, unknown>
}
