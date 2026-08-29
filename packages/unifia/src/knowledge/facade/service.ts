/* SPDX-License-Identifier: MIT */
/**
 * Knowledge service facade (P7.1).
 *
 * Single façade shared by Code, Work, and Design modes. No mode
 * has its own DB or cache. The facade exposes a minimal surface:
 * `search`, `get`, `backlinks`, `propose`, `doctor`, `status`.
 *
 * V1 is the *interface* and a default in-memory implementation.
 * The runtime talks to `NativeKnowledgePort` (Phase 2) for the
 * real backend.
 */

import type {
  McpKnowledgeStatusResponse,
  RetrievalResponse,
  MutationResult,
  KnowledgeId,
  KnowledgeLocator,
} from "@unifia/contracts/knowledge"
import type { SourceRegistry } from "../source/source.js"
import { ContextRouter, type RouterOutput } from "../context/router.js"
import { doctor, type DoctorInput, type DoctorReport } from "../admin/doctor.js"

export interface SearchRequest {
  query: string
  spaces: string[]
  types: string[]
  tags: string[]
  maxCandidates: number
  maxPayloadBytes: number
  maxSnippetBytes: number
  deadlineMs: number
}

export interface KnowledgeService {
  search(req: SearchRequest): Promise<RouterOutput>
  get(id?: KnowledgeId, locator?: KnowledgeLocator): Promise<RetrievalResponse | null>
  backlinks(target: { id?: KnowledgeId; locator?: KnowledgeLocator }): Promise<KnowledgeId[]>
  propose(input: { intent: unknown; reason: string; source: string }): Promise<MutationResult>
  doctor(input: DoctorInput): Promise<DoctorReport>
  status(): Promise<McpKnowledgeStatusResponse>
}

export class DefaultKnowledgeService implements KnowledgeService {
  constructor(
    private readonly registry: SourceRegistry,
    private readonly routerConfig: ConstructorParameters<typeof ContextRouter>[1],
  ) {}

  async search(req: SearchRequest): Promise<RouterOutput> {
    const router = new ContextRouter(this.registry, this.routerConfig)
    return router.route({
      query: req.query,
      spaces: req.spaces as never,
      types: req.types as never,
      tags: req.tags,
      maxCandidates: req.maxCandidates,
      maxPayloadBytes: req.maxPayloadBytes,
      maxSnippetBytes: req.maxSnippetBytes,
      deadlineMs: req.deadlineMs,
    })
  }

  async get(_id?: KnowledgeId, _locator?: KnowledgeLocator): Promise<RetrievalResponse | null> {
    return null
  }

  async backlinks(_target: { id?: KnowledgeId; locator?: KnowledgeLocator }): Promise<KnowledgeId[]> {
    return []
  }

  async propose(_input: { intent: unknown; reason: string; source: string }): Promise<MutationResult> {
    return { applied: false, auditId: `unverified-${Date.now()}` }
  }

  async doctor(input: DoctorInput): Promise<DoctorReport> {
    return doctor(input)
  }

  async status(): Promise<McpKnowledgeStatusResponse> {
    return {
      indexVersion: "v1",
      rebuiltAt: new Date().toISOString(),
      candidatesCount: 0,
      spaces: ["personal", "project", "session", "external"],
      capabilities: [
        { name: "knowledge_search", readOnly: true },
        { name: "knowledge_get", readOnly: true },
        { name: "knowledge_backlinks", readOnly: true },
        { name: "knowledge_trace", readOnly: true },
        { name: "knowledge_status", readOnly: true },
        { name: "knowledge_propose", readOnly: true },
      ],
      enabled: { fts: true, vector: false, graph: true },
    }
  }
}
