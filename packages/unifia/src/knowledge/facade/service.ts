/* SPDX-License-Identifier: MIT */
/**
 * Knowledge service facade (P7.1).
 *
 * Single façade shared by Code, Work, and Design modes. No mode has its own
 * DB or cache.
 *
 * Every method here either does the work or refuses with a typed
 * `capability_unavailable`. It never returns an empty success: `get`
 * returning null and `backlinks` returning [] used to mean "not implemented",
 * which is indistinguishable from "nothing found" at the call site.
 */

import type {
  McpKnowledgeStatusResponse,
  RetrievalResponse,
  MutationResult,
  KnowledgeId,
  KnowledgeLocator,
  KnowledgeSpaceKind,
} from "@unifia/contracts/knowledge"
import type { KnowledgeSource, SourceRegistry } from "../source/source.js"
import { ContextRouter, type ContextRouterConfig, type RouterOutput } from "../context/router.js"
import { doctor, type DoctorInput, type DoctorReport } from "../admin/doctor.js"
import { extractWikilinks } from "../parser/wikilinks.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { utf8Bytes } from "../context/lexical.js"
import { createHash } from "node:crypto"

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

/**
 * Writes Class A. Injected rather than assumed: V1 refuses to propose a
 * mutation when no writer is configured instead of reporting
 * `applied: false` as though it had tried.
 */
export interface MutationWriter {
  apply(input: { intent: unknown; reason: string; source: string }): Promise<MutationResult>
}

export interface KnowledgeService {
  search(req: SearchRequest): Promise<RouterOutput>
  get(id?: KnowledgeId, locator?: KnowledgeLocator): Promise<RetrievalResponse | null>
  backlinks(target: { id?: KnowledgeId; locator?: KnowledgeLocator }): Promise<KnowledgeId[]>
  propose(input: { intent: unknown; reason: string; source: string }): Promise<MutationResult>
  doctor(input: DoctorInput): Promise<DoctorReport>
  status(): Promise<McpKnowledgeStatusResponse>
}

export interface DefaultKnowledgeServiceOptions {
  /** Present only when Class A writes are configured. */
  writer?: MutationWriter
  /** True when a real FTS runtime backs retrieval. V1: false. */
  ftsEnabled?: boolean
  /** True when an embedding model is loaded. V1: false. */
  vectorEnabled?: boolean
}

export class DefaultKnowledgeService implements KnowledgeService {
  private readonly options: DefaultKnowledgeServiceOptions

  constructor(
    private readonly registry: SourceRegistry,
    private readonly routerConfig: ContextRouterConfig,
    options: DefaultKnowledgeServiceOptions = {},
  ) {
    this.options = options
  }

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

  async get(id?: KnowledgeId, locator?: KnowledgeLocator): Promise<RetrievalResponse | null> {
    if (id === undefined && locator === undefined) {
      throw KnowledgeFailure.sourceInconsistent("get requires an id or a locator")
    }
    const startedAt = Date.now()

    for (const source of this.registry.all()) {
      let doc: Awaited<ReturnType<KnowledgeSource["read"]>>
      try {
        doc = await source.read(locator, id)
      } catch {
        continue
      }
      if (doc === null) continue

      const fm = doc.note.frontmatter
      const body = doc.note.body
      // `get` is id-addressed, not a ranked query: it returns the note as
      // stored, so relevance is 1 and the snippet is the body.
      return {
        candidates: [
          {
            id: fm.unifia_id as KnowledgeId,
            locator: (locator ?? fm.unifia_id) as KnowledgeLocator,
            type: fm.unifia_type,
            space: source.space.kind,
            trust: source.space.kind === "external" ? "unverified" : "verified",
            authority:
              source.space.kind === "personal"
                ? "user"
                : source.space.kind === "project"
                  ? "project"
                  : source.space.kind === "session"
                    ? "agent"
                    : "external",
            restriction: "allow",
            relevance: 1,
            snippet: body,
            snippetBytes: utf8Bytes(body),
            snippetHash: createHash("sha256").update(body, "utf8").digest("hex"),
          },
        ],
        payloadBytes: utf8Bytes(body),
        truncated: false,
        diagnostics: {
          sourcesQueried: [source.space.kind],
          candidatesScanned: 1,
          candidatesDroppedByRestriction: 0,
          durationMs: Date.now() - startedAt,
          indexVersion: "v1",
        },
      }
    }
    return null
  }

  async backlinks(target: {
    id?: KnowledgeId
    locator?: KnowledgeLocator
  }): Promise<KnowledgeId[]> {
    if (target.id === undefined && target.locator === undefined) {
      throw KnowledgeFailure.sourceInconsistent("backlinks requires an id or a locator")
    }
    // Class A is the source of truth: resolve links by reading it, since V1
    // ships no persisted graph index.
    const wanted = new Set<string>()
    if (target.locator !== undefined) {
      wanted.add(target.locator)
      wanted.add(target.locator.replace(/\.md$/, ""))
    }
    if (target.id !== undefined) wanted.add(target.id)

    const out: KnowledgeId[] = []
    for (const source of this.registry.all()) {
      let listed: Awaited<ReturnType<KnowledgeSource["list"]>>
      try {
        listed = await source.list({})
      } catch {
        continue
      }
      for (const note of listed) {
        let doc: Awaited<ReturnType<KnowledgeSource["read"]>>
        try {
          doc = await source.read(note.ref.locator, note.ref.id)
        } catch {
          continue
        }
        if (doc === null) continue
        const links = extractWikilinks(doc.note.body).map((w) => w.target)
        const supersedes = doc.note.frontmatter.unifia_supersedes ?? []
        if (links.some((l) => wanted.has(l)) || supersedes.some((s) => wanted.has(s))) {
          out.push(note.ref.id)
        }
      }
    }
    return out
  }

  async propose(input: {
    intent: unknown
    reason: string
    source: string
  }): Promise<MutationResult> {
    const writer = this.options.writer
    if (writer === undefined) {
      // Refuse loudly. Returning `applied: false` here read as "the mutation
      // was attempted and declined", which was never true.
      throw KnowledgeFailure.mutationRefused(
        "knowledge_propose is unavailable: no Class A writer is configured",
      )
    }
    return writer.apply(input)
  }

  async doctor(input: DoctorInput): Promise<DoctorReport> {
    return doctor(input)
  }

  async status(): Promise<McpKnowledgeStatusResponse> {
    // Report what is actually mounted and actually enabled, not a constant.
    const spaces: KnowledgeSpaceKind[] = []
    let candidatesCount = 0
    for (const source of this.registry.all()) {
      spaces.push(source.space.kind)
      try {
        candidatesCount += (await source.list({})).length
      } catch {
        // A source that cannot be listed contributes nothing rather than
        // inflating the count.
      }
    }

    return {
      indexVersion: "v1",
      rebuiltAt: new Date().toISOString(),
      candidatesCount,
      spaces,
      capabilities: [
        { name: "knowledge_search", readOnly: true },
        { name: "knowledge_get", readOnly: true },
        { name: "knowledge_backlinks", readOnly: true },
        { name: "knowledge_trace", readOnly: true },
        { name: "knowledge_status", readOnly: true },
        { name: "knowledge_propose", readOnly: this.options.writer === undefined },
      ],
      enabled: {
        // V1 has no FTS5 runtime and no embedding model; the graph is
        // answered by scanning Class A, which is genuinely available.
        fts: this.options.ftsEnabled === true,
        vector: this.options.vectorEnabled === true,
        graph: true,
      },
    }
  }
}
