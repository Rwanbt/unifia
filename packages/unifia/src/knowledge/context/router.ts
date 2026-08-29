/* SPDX-License-Identifier: MIT */
/**
 * ContextRouter — produces a `ContextPack` from a `RetrievalRequest`
 * and a `SourceRegistry`.
 *
 * Per ADR-KNOW-0008 and plan gelé §35-36, the router:
 * 1. fans out the request to the requested spaces,
 * 2. collects candidates,
 * 3. applies egress policy (egress.ts),
 * 4. deduplicates and diversifies (per-type cap),
 * 5. applies token budget,
 * 6. emits diagnostics.
 *
 * V1 is a strict, deterministic router. It does NOT do semantic
 * ranking; ranking is delegated to the source layer (Phase 5
 * adds embeddings).
 */

import type {
  ContextItem,
  ContextPack,
  ContextDiagnostics,
  ProviderDestinationPlan,
  RetrievalCandidate,
  RetrievalRequest,
  KnowledgeSpaceKind,
} from "@unifia/contracts/knowledge"
import { ProviderDestinationPlanSchema } from "@unifia/contracts/knowledge"
import type { KnowledgeSource, SourceRegistry } from "../source/source.js"
import { decideEgress } from "../policy/egress.js"

/** Heuristic token cost: ~4 chars per token. */
function estimateTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4))
}

const DEFAULT_TOKEN_BUDGET = 8_000
const DEFAULT_MAX_PER_TYPE = 8

export interface ContextRouterConfig {
  providerPlan: ProviderDestinationPlan
  tokenBudget?: number
  maxPerType?: number
  /** Hard deadline in ms; the router is purely sync today. */
  deadlineMs?: number
}

export interface RoutedItem {
  candidate: RetrievalCandidate
  included: boolean
  exclusionReason?: string
  tokenCost: number
}

export interface RouterOutput {
  pack: ContextPack
  /** Items dropped by policy, with reasons (for the Inspector). */
  excluded: Array<{ candidate: RetrievalCandidate; reason: string }>
}

export class ContextRouter {
  constructor(
    private readonly registry: SourceRegistry,
    private readonly config: ContextRouterConfig,
  ) {
    const r = ProviderDestinationPlanSchema.safeParse(config.providerPlan)
    if (!r.success) {
      throw new Error(`invalid providerPlan: ${r.error.message}`)
    }
  }

  async route(request: RetrievalRequest): Promise<RouterOutput> {
    const budget = this.config.tokenBudget ?? DEFAULT_TOKEN_BUDGET
    const maxPerType = this.config.maxPerType ?? DEFAULT_MAX_PER_TYPE
    const t0 = Date.now()

    const spaces = this.resolveSpaces(request)
    const sources = spaces
      .map((kind) => this.registry.byKind(kind))
      .filter((s): s is KnowledgeSource => s !== undefined)

    const allCandidates: RetrievalCandidate[] = []
    for (const source of sources) {
      const listOpts: Parameters<KnowledgeSource["list"]>[0] = {
        limit: request.maxCandidates,
      }
      const listed = await source.list(listOpts)
      for (const note of listed) {
        allCandidates.push({
          id: note.ref.id,
          locator: note.ref.locator,
          type: note.type,
          space: source.space.kind,
          trust: "verified",
          authority: source.space.kind === "personal" ? "user" : source.space.kind === "project" ? "project" : "external",
          restriction: "allow",
          relevance: 0.5,
          snippet: "",
          snippetBytes: 0,
          snippetHash: "0".repeat(64),
        })
      }
    }

    const diagnostics: ContextDiagnostics = {
      sourcesQueried: spaces,
      candidatesScanned: allCandidates.length,
      candidatesDroppedByRestriction: 0,
      totalTokenCost: 0,
      durationMs: 0,
    }

    const items: ContextItem[] = []
    const excluded: Array<{ candidate: RetrievalCandidate; reason: string }> = []
    let totalTokenCost = 0
    let perTypeCount = new Map<ContextItem["type"], number>()

    for (const candidate of allCandidates) {
      const item = candidateToContextItem(candidate)
      const decision = decideEgress({ item, plan: this.config.providerPlan })
      if (decision.decision === "deny") {
        excluded.push({ candidate, reason: decision.reason })
        diagnostics.candidatesDroppedByRestriction += 1
        continue
      }
      const count = perTypeCount.get(item.type) ?? 0
      if (count >= maxPerType) {
        excluded.push({ candidate, reason: "per-type cap reached" })
        continue
      }
      const cost = estimateTokens(item.snippet)
      if (totalTokenCost + cost > budget) {
        excluded.push({ candidate, reason: "token budget exhausted" })
        continue
      }
      items.push(item)
      totalTokenCost += cost
      perTypeCount.set(item.type, count + 1)
    }

    diagnostics.totalTokenCost = totalTokenCost
    diagnostics.durationMs = Date.now() - t0

    const pack: ContextPack = {
      providerPlan: this.config.providerPlan,
      tokenBudget: budget,
      items,
      diagnostics,
    }
    return { pack, excluded }
  }

  private resolveSpaces(request: RetrievalRequest): KnowledgeSpaceKind[] {
    if (request.spaces.length > 0) return [...request.spaces]
    return ["personal", "project", "session", "external"]
  }
}

function candidateToContextItem(c: RetrievalCandidate): ContextItem {
  return {
    ref: { id: c.id, locator: c.locator },
    source: c.space,
    type: c.type,
    trust: c.trust,
    authority: c.authority,
    restriction: c.restriction,
    relevance: c.relevance,
    tokenCost: estimateTokens(c.snippet),
    contentHash: c.snippetHash,
    snippet: c.snippet,
    reason: `matched on space=${c.space}`,
    temporalState: "active",
  }
}
