/* SPDX-License-Identifier: MIT */
/**
 * MCP knowledge daemon (card C26).
 *
 * `composeMcpServer()` produced an authenticated, bounded server that nothing
 * exposed, and a token lived only as long as the process that issued it. This
 * module is the process: it holds one server and one registry for its whole
 * lifetime and answers JSON-RPC over an injected transport, so a token issued
 * at startup stays valid for every call that follows.
 *
 * Framing and error codes come from `@unifia/mcp-transport`; this file adds
 * only the dispatch and the mapping from knowledge failures to JSON-RPC
 * errors. A second JSON-RPC implementation would be a second place for the
 * two to disagree.
 */

import {
  JSON_RPC_ERRORS,
  isRequest,
  type JsonRpcMessage,
  type MessageTransport,
} from "@unifia/mcp-transport"
import type { McpKnowledgeCapability } from "@unifia/contracts/knowledge"
import { MCP_KNOWLEDGE_METHODS } from "@unifia/contracts/knowledge"
import { composeMcpServer, type ComposedMcp } from "./compose.js"
import {
  McpOversizedPayload,
  McpRateLimitExceeded,
  McpUnauthorized,
  type McpCallContext,
} from "./server.js"

export interface ServeInput {
  workspaceRoot: string
  transport: MessageTransport
  /** Token lifetime for the session token minted at startup. */
  ttlMs?: number
  /** Methods the session token may call. Defaults to the read-only set. */
  methods?: readonly McpKnowledgeCapability[]
}

export interface ServeHandle {
  /** The token a client must present. Valid for the daemon's lifetime. */
  tokenId: string
  composed: ComposedMcp
  /** Resolves when the transport closes. */
  done: Promise<void>
}

/** Map a failure onto a JSON-RPC error body without leaking internals. */
function toErrorBody(e: unknown): { code: number; message: string } {
  if (e instanceof McpUnauthorized) {
    return { code: JSON_RPC_ERRORS.unauthorized, message: e.message }
  }
  if (e instanceof McpRateLimitExceeded) {
    return { code: JSON_RPC_ERRORS.rateLimited, message: e.message }
  }
  if (e instanceof McpOversizedPayload) {
    return { code: JSON_RPC_ERRORS.invalidParams, message: e.message }
  }
  // Anything else is internal: report the kind, never the stack.
  return {
    code: JSON_RPC_ERRORS.internal,
    message: e instanceof Error ? e.message : String(e),
  }
}

/**
 * Serve the six knowledge capabilities over `transport` until it closes.
 *
 * The caller owns the transport, so the daemon works over stdio, over a
 * loopback pair in a test, or over anything else that frames JSON-RPC.
 */
export function serveMcp(input: ServeInput): ServeHandle {
  const composed = composeMcpServer({ workspaceRoot: input.workspaceRoot })
  const token = composed.issue({
    ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
    ...(input.methods !== undefined ? { methods: input.methods } : {}),
  })
  const ctx: McpCallContext = { tokenId: token.id }
  const { server } = composed

  const dispatch = async (method: string, params: unknown): Promise<unknown> => {
    // The token is the daemon's; a client identifies itself by presenting it
    // in the params, so a caller without it cannot reach any capability.
    const supplied = (params as { token?: unknown } | null)?.token
    const callCtx: McpCallContext =
      typeof supplied === "string" && supplied.length > 0 ? { tokenId: supplied } : ctx
    const req = params as never

    switch (method) {
      case "knowledge_search":
        return server.search(req, callCtx)
      case "knowledge_get":
        return server.get(req, callCtx)
      case "knowledge_backlinks":
        return server.backlinks(req, callCtx)
      case "knowledge_trace":
        return server.trace(req, callCtx)
      case "knowledge_status":
        return server.status(callCtx)
      case "knowledge_propose":
        return server.propose(req, callCtx)
      default:
        return undefined
    }
  }

  const done = (async () => {
    for await (const message of input.transport.receive()) {
      if (!isRequest(message)) continue

      if (!MCP_KNOWLEDGE_METHODS.includes(message.method as McpKnowledgeCapability)) {
        await send(input.transport, {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: JSON_RPC_ERRORS.methodNotFound,
            message: `unknown method: ${message.method}`,
          },
        })
        continue
      }

      try {
        const result = await dispatch(message.method, message.params)
        await send(input.transport, { jsonrpc: "2.0", id: message.id, result })
      } catch (e) {
        await send(input.transport, {
          jsonrpc: "2.0",
          id: message.id,
          error: toErrorBody(e),
        })
      }
    }
  })()

  return { tokenId: token.id, composed, done }
}

/** A failed send must not take the daemon down with it. */
async function send(transport: MessageTransport, message: JsonRpcMessage): Promise<void> {
  try {
    await transport.send(message)
  } catch {
    // The peer is gone; the receive loop will end on its own.
  }
}
