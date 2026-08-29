/* SPDX-License-Identifier: MIT */
/**
 * Indexer (P3.2).
 *
 * Bounded: `maxCandidates`, `maxPayloadBytes`, `maxSnippetBytes`,
 * `deadlineMs`. Pure when possible; I/O is in the adapter.
 *
 * V1 implements the *interface* and a chunker. SQLite runtime
 * is added in a follow-up commit.
 */

import type { KnowledgeId, KnowledgeLocator, KnowledgeVersionHash } from "@unifia/contracts/knowledge"

export interface IndexerLimits {
  maxCandidates: number
  maxPayloadBytes: number
  maxSnippetBytes: number
  deadlineMs: number
}

export const DEFAULT_INDEXER_LIMITS: IndexerLimits = {
  maxCandidates: 50,
  maxPayloadBytes: 1024 * 1024,
  maxSnippetBytes: 64 * 1024,
  deadlineMs: 2_000,
}

/** A chunk of a note's body. */
export interface Chunk {
  text: string
  startOffset: number
  endOffset: number
}

/** Chunk a body by approximate character budget. */
export function chunkBody(body: string, maxChars: number): Chunk[] {
  if (maxChars < 16) maxChars = 16
  const out: Chunk[] = []
  let cursor = 0
  while (cursor < body.length) {
    const end = Math.min(body.length, cursor + maxChars)
    // Prefer to break on a newline.
    let cut = end
    if (end < body.length) {
      const nl = body.lastIndexOf("\n", end)
      if (nl > cursor + Math.floor(maxChars / 2)) cut = nl + 1
    }
    const text = body.slice(cursor, cut)
    if (text.length > 0) {
      out.push({ text, startOffset: cursor, endOffset: cut })
    }
    cursor = cut
  }
  return out
}

/** A wikilink edge extracted from a parsed body. */
export interface LinkEdge {
  source: KnowledgeLocator
  target: KnowledgeLocator
  relation: "wikilink"
}

/** Extract link edges from raw text (matches `[[X]]`). */
export function extractEdges(body: string, source: KnowledgeLocator): LinkEdge[] {
  const re = /\[\[([^\]\n]+?)\]\]/g
  const out: LinkEdge[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const inner = m[1]
    if (inner === undefined) continue
    const bar = inner.indexOf("|")
    const targetRaw = bar === -1 ? inner : inner.slice(0, bar)
    const hash = targetRaw.indexOf("#")
    const target = (hash === -1 ? targetRaw : targetRaw.slice(0, hash)).trim()
    if (target.length === 0) continue
    out.push({ source, target, relation: "wikilink" })
  }
  return out
}

export interface IndexedNote {
  id: KnowledgeId
  locator: KnowledgeLocator
  versionHash: KnowledgeVersionHash
  chunks: Chunk[]
  edges: LinkEdge[]
}

export function indexNote(input: {
  id: KnowledgeId
  locator: KnowledgeLocator
  versionHash: KnowledgeVersionHash
  body: string
  chunkSize: number
}): IndexedNote {
  const chunks = chunkBody(input.body, input.chunkSize)
  const edges = extractEdges(input.body, input.locator)
  return {
    id: input.id,
    locator: input.locator,
    versionHash: input.versionHash,
    chunks,
    edges,
  }
}
