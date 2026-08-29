/* SPDX-License-Identifier: MIT */
/**
 * Filesystem-backed knowledge source.
 *
 * Until now every `KnowledgeSource` in the tree was a decorator around an
 * injected implementation, and the only implementation the CLI ever injected
 * was a pair of hardcoded notes — so `knowledge search` answered from two
 * synthetic notes rather than the vault. This module is the missing leaf: it
 * reads Class A Markdown from disk.
 *
 * Class A is the source of truth (ADR-KNOW-0002), so this reads `.md` files
 * directly and never consults a derived index.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { isAbsolute, join, relative, sep } from "node:path"
import type {
  KnowledgeId,
  KnowledgeLocator,
  KnowledgeSpace,
} from "@unifia/contracts/knowledge"
import { KnowledgeFailure } from "../domain/errors.js"
import { parseDocument, type ParsedDocument } from "../parser/parser.js"
import type { KnowledgeSource, ListOptions, ListedNote, SourceEvent } from "./source.js"

/** Directories that never hold Class A notes. */
const SKIPPED_DIRECTORIES = new Set([".git", ".unifia", "node_modules", ".obsidian"])

/** Walk `dir`, collecting locators relative to `root`, POSIX-separated. */
function walkMarkdown(root: string, dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    // An unreadable directory is not a corpus error: skip it and keep going.
    return
  }
  for (const name of entries) {
    if (SKIPPED_DIRECTORIES.has(name)) continue
    const full = join(dir, name)
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      walkMarkdown(root, full, out)
      continue
    }
    if (!name.toLowerCase().endsWith(".md")) continue
    out.push(relative(root, full).split(sep).join("/"))
  }
}

export interface VaultSourceConfig {
  /** Absolute path to the vault root. */
  root: string
  /** The space this vault backs. */
  space: KnowledgeSpace
}

/**
 * A `KnowledgeSource` reading Class A Markdown from a directory.
 *
 * `list` skips files that fail to parse rather than aborting the whole scan:
 * a vault is user-editable and one malformed note must not blind retrieval.
 * The count is reported through `lastScanErrors` so a caller can surface it
 * instead of silently swallowing the failures.
 */
export class VaultSource implements KnowledgeSource {
  readonly space: KnowledgeSpace
  private readonly root: string
  private scanErrors: Array<{ locator: string; message: string }> = []

  constructor(config: VaultSourceConfig) {
    if (!isAbsolute(config.root)) {
      throw KnowledgeFailure.pathUnresolved(
        `vault root must be absolute, got ${config.root}`,
      )
    }
    this.root = config.root
    this.space = config.space
  }

  /** Notes skipped by the last `list()` because they failed to parse. */
  get lastScanErrors(): ReadonlyArray<{ locator: string; message: string }> {
    return this.scanErrors
  }

  /** Locators of every Markdown file under the root. */
  locators(): string[] {
    const out: string[] = []
    walkMarkdown(this.root, this.root, out)
    out.sort()
    return out
  }

  async list(options: ListOptions): Promise<ListedNote[]> {
    const errors: Array<{ locator: string; message: string }> = []
    const notes: ListedNote[] = []

    const lifecycles = options.lifecycles
    const prefix = options.prefix

    for (const locator of this.locators()) {
      if (prefix !== undefined && prefix.length > 0 && !locator.startsWith(prefix)) continue
      let parsed: ParsedDocument
      try {
        parsed = parseDocument(readFileSync(join(this.root, locator), "utf8"))
      } catch (e) {
        errors.push({ locator, message: (e as Error).message })
        continue
      }
      const fm = parsed.note.frontmatter
      if (lifecycles !== undefined && !lifecycles.includes(fm.unifia_lifecycle)) continue
      notes.push({
        ref: { id: fm.unifia_id as KnowledgeId, locator: locator as KnowledgeLocator },
        type: fm.unifia_type,
        lifecycle: fm.unifia_lifecycle,
        updatedAt: fm.unifia_updated_at,
      })
    }

    this.scanErrors = errors
    // Newest first, then locator so equal timestamps stay deterministic.
    notes.sort((a, b) =>
      a.updatedAt === b.updatedAt
        ? a.ref.locator.localeCompare(b.ref.locator)
        : b.updatedAt.localeCompare(a.updatedAt),
    )
    const limit = options.limit
    return limit !== undefined && limit >= 0 ? notes.slice(0, limit) : notes
  }

  async read(locator?: KnowledgeLocator, id?: KnowledgeId): Promise<ParsedDocument | null> {
    if (locator === undefined && id === undefined) {
      throw KnowledgeFailure.sourceInconsistent("read requires a locator or an id")
    }

    if (locator !== undefined) {
      return this.readLocator(locator)
    }

    // No derived index in V1: resolve an id by scanning Class A.
    for (const candidate of this.locators()) {
      const doc = this.readLocator(candidate as KnowledgeLocator)
      if (doc !== null && doc.note.frontmatter.unifia_id === id) return doc
    }
    return null
  }

  private readLocator(locator: KnowledgeLocator): ParsedDocument | null {
    // Containment: a locator may not climb out of the vault root.
    const full = join(this.root, locator)
    const rel = relative(this.root, full)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw KnowledgeFailure.pathUnresolved(`locator escapes the vault root: ${locator}`)
    }
    let raw: string
    try {
      raw = readFileSync(full, "utf8")
    } catch {
      return null
    }
    try {
      return parseDocument(raw)
    } catch {
      return null
    }
  }

  watch(_onChange: (event: SourceEvent) => void): () => void {
    // V1 ships no filesystem watcher. Returning a no-op unsubscribe would
    // look like a live subscription that never fires, so refuse instead.
    throw KnowledgeFailure.indexUnavailable(
      "filesystem watching is not implemented in V1; re-run the query to pick up changes",
    )
  }
}
