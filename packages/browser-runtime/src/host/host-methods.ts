/* SPDX-License-Identifier: MIT */
/**
 * The RPC surface of the Node Browser host: one wire method per call on
 * `BrowserSessionManager` (ADR-089 §2).
 *
 * Split from `host-main.ts` so the mapping can be read and tested on its own.
 * The host owns lifecycle, the mirror and the asks; this file only translates
 * frames into service calls and service results back into frames.
 */
import type { BrowserSessionService } from "../session-service.ts"
import {
  decodeBytes,
  encodeBytes,
  type HostErrorBody,
  type HostRequest,
} from "./protocol.ts"
import type {
  BrowserController,
  BrowserHistoryAction,
  BrowserInteractionAction,
  BrowserRuntimeProfile,
  BrowserViewport,
  BrowserViewportInput,
  P3Capability,
} from "@unifia/contracts"
import { HOST_PROTOCOL_VERSION } from "./protocol.ts"

export type HostReply = { id: number; result?: unknown; error?: HostErrorBody }

export type HostDispatch = {
  /** Sends the outcome of one request back to the server. */
  reply: (reply: HostReply) => void
  /** Asks the server to clear a sensitive action; false means declined. */
  askApproval: (sessionId: string, reason: string) => Promise<boolean>
}

export function toErrorBody(error: unknown): HostErrorBody {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: "BrowserHostError", message: String(error) }
}

/**
 * Screenshots and uploads leave as base64; everything else is plain JSON.
 * `undefined` becomes `null` because JSON.stringify drops the key, and a frame
 * with neither `result` nor `error` is rejected as malformed by the receiver:
 * every void call (act, input, upload) would otherwise kill the connection.
 */
function encodeResult(result: unknown): unknown {
  if (result === undefined) return null
  return result instanceof Uint8Array ? { base64: encodeBytes(result) } : result
}

/**
 * Runs one request against the service and answers it. Never rejects: a host
 * that dies on a bad frame takes the live browser with it, so every failure
 * becomes a typed error reply.
 *
 * Returns once the reply has been handed to the transport, so a caller that
 * sequences requests — the tests, and the stdio loop when it drains — knows the
 * outcome has already been written.
 */
export async function dispatchHostRequest(service: BrowserSessionService, frame: HostRequest, transport: HostDispatch): Promise<void> {
  const { id } = frame
  const params = (frame.params ?? {}) as Record<string, unknown>
  const sessionId = String(params.sessionId ?? "")
  const tabId = String(params.tabId ?? "")
  const fail = (error: unknown) => transport.reply({ id, error: toErrorBody(error) })
  const done = (operation: Promise<unknown>) => operation.then((value) => transport.reply({ id, result: encodeResult(value) }), fail)

  switch (frame.method) {
    case "host.ping":
      return transport.reply({ id, result: { version: HOST_PROTOCOL_VERSION } })
    case "host.shutdown":
      return done(service.shutdown().then(() => ({ stopped: true })))
    case "session.create":
      return done(
        Promise.resolve(
          service.create({
            workspaceId: String(params.workspaceId),
            ...(typeof params.chatSessionId === "string" ? { chatSessionId: params.chatSessionId } : {}),
            runtimeProfile: params.runtimeProfile as BrowserRuntimeProfile,
            viewport: params.viewport as BrowserViewport,
            ...(Array.isArray(params.capabilities) ? { capabilities: params.capabilities as readonly P3Capability[] } : {}),
          }),
        ),
      )
    case "session.bindCapabilities":
      service.bindCapabilities(sessionId, (params.capabilities ?? []) as readonly P3Capability[])
      return transport.reply({ id, result: { bound: true } })
    case "session.openTab":
      return done(service.openTab(sessionId, typeof params.url === "string" ? params.url : undefined))
    case "session.navigate":
      return done(
        service.navigate(
          sessionId,
          tabId,
          String(params.url),
          params.controller as "user" | "ai",
          typeof params.approvedOrigin === "string" ? params.approvedOrigin : undefined,
        ),
      )
    case "session.history":
      return done(service.history(sessionId, tabId, params.action as BrowserHistoryAction))
    case "session.resizeViewport":
      return done(service.resizeViewport(sessionId, params.viewport as BrowserViewport))
    case "session.refreshTab":
      return done(service.refreshTab(sessionId, tabId))
    case "session.selectTab":
      return done(service.selectTab(sessionId, tabId))
    case "session.closeTab":
      return done(service.closeTab(sessionId, tabId))
    case "session.close":
      return done(service.close(sessionId).then(() => ({ closed: true })))
    case "session.observe":
      return done(service.observe(sessionId, tabId))
    case "session.actionApprovalRequirement":
      return done(
        service.actionApprovalRequirement(sessionId, tabId, String(params.observationId), params.action as BrowserInteractionAction),
      )
    case "session.act":
      return done(
        service.act(sessionId, tabId, String(params.observationId), params.action as BrowserInteractionAction, async (reason) => {
          if (!await transport.askApproval(sessionId, reason)) throw new Error("Browser action was declined")
        }),
      )
    case "session.input":
      return done(service.input(sessionId, tabId, params.action as BrowserViewportInput))
    case "session.upload":
      return done(
        service.upload(sessionId, tabId, {
          name: String(params.name),
          mediaType: String(params.mediaType),
          bytes: decodeBytes(String(params.base64)),
        }),
      )
    case "session.screenshot":
      return done(service.screenshot(sessionId, tabId).then((bytes) => ({ base64: encodeBytes(bytes) })))
    case "session.releaseDownload":
      return done(service.releaseDownload(sessionId, String(params.downloadId)))
    case "session.takeControl":
      return done(service.takeControl(sessionId, params.controller as BrowserController))
    default:
      return fail(new Error(`unknown host method ${frame.method}`))
  }
}
