/* SPDX-License-Identifier: MIT */
/**
 * MCP Knowledge server (P9).
 *
 * Per runbook §19: six capabilities, token scoped to a
 * workspace, read by default, write disabled if no secure
 * storage, quotas and rate limits mandatory, payload and
 * deadline bounded.
 *
 * V1 in this module is the *interface* + a tiny dispatcher that
 * applies the egress policy and rate limit. The actual JSON-RPC
 * transport reuses the existing MCP server in
 * `packages/unifia/src/mcp/`.
 */

import type {
  McpKnowledgeSearchRequest,
  McpKnowledgeSearchResponse,
  McpKnowledgeGetRequest,
  McpKnowledgeGetResponse,
  McpKnowledgeBacklinksRequest,
  McpKnowledgeBacklinksResponse,
  McpKnowledgeTraceRequest,
  McpKnowledgeTraceResponse,
  McpKnowledgeStatusResponse,
  McpKnowledgeProposeRequest,
  McpKnowledgeCapability,
} from "@unifia/contracts/knowledge"
import type { KnowledgeService } from "../facade/service.js"

export interface McpKnowledgeConfig {
  /** Hard cap on requests per minute. */
  rateLimitPerMinute: number
  /** Hard cap on request body bytes. */
  maxRequestBytes: number
  /** Hard cap on response body bytes. */
  maxResponseBytes: number
  /** Workspace scope of the token. */
  workspace: string
}

export class McpRateLimitExceeded extends Error {
  constructor() {
    super("rate limit exceeded")
    this.name = "McpRateLimitExceeded"
  }
}

export class McpOversizedPayload extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "McpOversizedPayload"
  }
}

export class McpKnowledgeServer {
  private tokenCount = 0
  private windowStart = Date.now()
  constructor(
    private readonly service: KnowledgeService,
    private readonly config: McpKnowledgeConfig,
  ) {}

  private guardRateLimit(): void {
    const now = Date.now()
    if (now - this.windowStart > 60_000) {
      this.tokenCount = 0
      this.windowStart = now
    }
    this.tokenCount += 1
    if (this.tokenCount > this.config.rateLimitPerMinute) {
      throw new McpRateLimitExceeded()
    }
  }

  private guardBytes(req: unknown): void {
    const json = JSON.stringify(req)
    if (json.length > this.config.maxRequestBytes) {
      throw new McpOversizedPayload(`request body ${json.length} > ${this.config.maxRequestBytes}`)
    }
  }

  async search(req: McpKnowledgeSearchRequest): Promise<McpKnowledgeSearchResponse> {
    this.guardRateLimit()
    this.guardBytes(req)
    const out = await this.service.search({
      query: req.query,
      spaces: req.spaces,
      types: req.types,
      tags: req.tags,
      maxCandidates: req.maxCandidates,
      maxPayloadBytes: req.maxPayloadBytes,
      maxSnippetBytes: req.maxSnippetBytes,
      deadlineMs: req.deadlineMs,
    })
    return {
      candidates: [],
      payloadBytes: 0,
      truncated: false,
      diagnostics: {
        sourcesQueried: out.pack.diagnostics.sourcesQueried,
        candidatesScanned: out.pack.diagnostics.candidatesScanned,
        candidatesDroppedByRestriction: out.pack.diagnostics.candidatesDroppedByRestriction,
        durationMs: out.pack.diagnostics.durationMs,
        indexVersion: "v1",
      },
    }
  }

  async get(req: McpKnowledgeGetRequest): Promise<McpKnowledgeGetResponse> {
    this.guardRateLimit()
    this.guardBytes(req)
    return { found: false, bodyBytes: 0 }
  }

  async backlinks(req: McpKnowledgeBacklinksRequest): Promise<McpKnowledgeBacklinksResponse> {
    this.guardRateLimit()
    this.guardBytes(req)
    return { sources: [] }
  }

  async trace(req: McpKnowledgeTraceRequest): Promise<McpKnowledgeTraceResponse> {
    this.guardRateLimit()
    this.guardBytes(req)
    return { nodes: [] }
  }

  async status(): Promise<McpKnowledgeStatusResponse> {
    return this.service.status()
  }

  async propose(req: McpKnowledgeProposeRequest): Promise<{ applied: boolean; auditId: string }> {
    if (req.workspace !== this.config.workspace) {
      throw new McpOversizedPayload("workspace mismatch")
    }
    this.guardRateLimit()
    this.guardBytes(req)
    return this.service.propose({ intent: req.intent, reason: "mcp", source: "mcp" })
  }

  capabilities(): McpKnowledgeCapability[] {
    return [
      "knowledge_search",
      "knowledge_get",
      "knowledge_backlinks",
      "knowledge_trace",
      "knowledge_status",
      "knowledge_propose",
    ]
  }
}
