/* SPDX-License-Identifier: MIT */
/**
 * Class A writer (card C25).
 *
 * V1 had no write path at all: `MutationWriter` was an interface with no
 * implementation, so `knowledge_propose` could only refuse. A memory layer
 * that cannot remember is not a memory layer.
 *
 * Every mutation here:
 * - is validated against `MutationIntentSchema`;
 * - is confined to the workspace on resolved real paths, shared with the
 *   reader so the two cannot disagree about the boundary;
 * - is refused when the body carries a credential (ADR-KNOW-0006 §5);
 * - honours compare-and-swap on the observed version hash;
 * - is recorded in an append-only WAL before the file is made visible;
 * - is applied atomically (write to a temporary file, then rename).
 *
 * `delete` is refused outright: ADR-KNOW-0009 rejects physical deletion and
 * P10 forbids silent destructive operations. Archiving is the supported way
 * to retire a note, and it keeps the file.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { dirname, isAbsolute, join } from "node:path"
import type {
  MutationIntent,
  MutationResult,
  KnowledgeId,
  NoteFrontmatter,
} from "@unifia/contracts/knowledge"
import { MutationIntentSchema, portableRestrictionsToFrontmatter } from "@unifia/contracts/knowledge"
import { KnowledgeFailure } from "../domain/errors.js"
import { parseFrontmatter, serialiseNote } from "../parser/frontmatter.js"
import { classifyText } from "../context/dataflow.js"
import { isContained, wouldBeContained, realOrNull } from "../source/containment.js"
import { VaultSource } from "../source/vault.js"
import { isTransitionAllowed } from "../memory/lifecycle.js"
import type { WalEntry, WalKind } from "../wal/wal.js"
import { validateEntry } from "../wal/wal.js"
import type { MutationWriter } from "../facade/service.js"

/** Where the append-only write-ahead log lives. */
export const WAL_FILE = ".unifia/wal.jsonl"

export interface VaultMutationWriterConfig {
  /** Absolute path to the vault root that receives the writes. */
  root: string
  /** Where new notes are created when the intent gives no locator. */
  inboxSubdir?: string
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex")
}

export class VaultMutationWriter implements MutationWriter {
  private readonly root: string
  private readonly realRoot: string
  private readonly inbox: string

  constructor(config: VaultMutationWriterConfig) {
    if (!isAbsolute(config.root)) {
      throw KnowledgeFailure.pathUnresolved(`vault root must be absolute, got ${config.root}`)
    }
    const real = realOrNull(config.root)
    if (real === null) {
      throw KnowledgeFailure.pathUnresolved(`vault root cannot be resolved: ${config.root}`)
    }
    this.root = config.root
    this.realRoot = real
    this.inbox = config.inboxSubdir ?? "inbox"
  }

  async apply(input: {
    intent: unknown
    reason: string
    source: string
  }): Promise<MutationResult> {
    const parsed = MutationIntentSchema.safeParse(input.intent)
    if (!parsed.success) {
      throw KnowledgeFailure.mutationRefused(
        `invalid mutation intent: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      )
    }
    const intent = parsed.data as MutationIntent

    if (intent.kind === "delete") {
      // ADR-KNOW-0009 rejects physical deletion; P10 forbids a silent
      // destructive operation. Archiving retires a note and keeps the file.
      throw KnowledgeFailure.mutationRefused(
        "delete is not supported: archive the note instead (ADR-KNOW-0009)",
      )
    }

    const auditId = randomUUID()
    switch (intent.kind) {
      case "create":
        return this.create(intent, auditId)
      case "update":
        return this.update(intent, auditId)
      case "promote":
      case "supersede":
      case "archive":
      case "restore":
        return this.transition(intent, auditId)
      default:
        throw KnowledgeFailure.mutationRefused(`unsupported mutation kind: ${intent.kind}`)
    }
  }

  // -- kinds ---------------------------------------------------------------

  private create(intent: MutationIntent, auditId: string): MutationResult {
    const content = intent.newContent
    if (content === undefined) {
      throw KnowledgeFailure.mutationRefused("create requires newContent")
    }
    this.refuseCredentials(content.body)

    const locator = intent.targetLocator ?? `${this.inbox}/${auditId}.md`
    const full = this.resolveWritable(locator)
    if (existsSync(full)) {
      throw KnowledgeFailure.casMismatch("absent", "present")
    }

    const now = new Date().toISOString()
    const frontmatter: NoteFrontmatter = {
      unifia_schema: 1,
      unifia_id: (intent.targetId ?? randomUUIDv7()) as KnowledgeId,
      unifia_type: content.type,
      // A new note enters as a candidate: promotion is a separate, audited
      // step (ADR-KNOW-0009 §1), never a side effect of writing.
      unifia_lifecycle: "candidate",
      unifia_created_at: now,
      unifia_updated_at: now,
      unifia_project_ref: intent.source,
      unifia_supersedes: [],
      unifia_tags: intent.tags ?? [],
    }
    const restrictions = portableRestrictionsToFrontmatter(content.restrictions)
    if (Object.keys(restrictions).length > 0) {
      frontmatter.unifia_restrictions = restrictions
    }

    const raw = serialiseNote({ frontmatter, body: content.body, raw: "" })
    return this.commit("create", locator, full, raw, null, intent, auditId)
  }

  private update(intent: MutationIntent, auditId: string): MutationResult {
    const content = intent.newContent
    if (content === undefined) {
      throw KnowledgeFailure.mutationRefused("update requires newContent")
    }
    this.refuseCredentials(content.body)

    const { locator, full, raw: current } = this.locate(intent.targetId)
    this.assertCas(current, intent.expectedVersionHash)

    const note = parseFrontmatter(current)
    const next: NoteFrontmatter = {
      ...note.frontmatter,
      unifia_type: content.type,
      unifia_updated_at: new Date().toISOString(),
      unifia_tags: intent.tags ?? note.frontmatter.unifia_tags,
    }
    const restrictions = portableRestrictionsToFrontmatter(content.restrictions)
    if (Object.keys(restrictions).length > 0) next.unifia_restrictions = restrictions
    else delete next.unifia_restrictions

    const raw = serialiseNote({ frontmatter: next, body: content.body, raw: current })
    return this.commit("update", locator, full, raw, sha256(current), intent, auditId)
  }

  private transition(intent: MutationIntent, auditId: string): MutationResult {
    const { locator, full, raw: current } = this.locate(intent.targetId)
    this.assertCas(current, intent.expectedVersionHash)

    const note = parseFrontmatter(current)
    const from = note.frontmatter.unifia_lifecycle
    const to =
      intent.kind === "promote" || intent.kind === "restore"
        ? "active"
        : intent.kind === "archive"
          ? "archived"
          : "superseded"

    if (!isTransitionAllowed(from, to)) {
      throw KnowledgeFailure.mutationRefused(`transition ${from} -> ${to} is not allowed`)
    }

    const next: NoteFrontmatter = {
      ...note.frontmatter,
      unifia_lifecycle: to,
      unifia_updated_at: new Date().toISOString(),
    }
    if (intent.kind === "supersede" && intent.successorId !== undefined) {
      // The successor records what it replaces; the superseded note keeps its
      // own id and stays readable (ADR-KNOW-0009 §3).
      next.unifia_supersedes = [...note.frontmatter.unifia_supersedes]
    }

    const raw = serialiseNote({ frontmatter: next, body: note.body, raw: current })
    return this.commit(intent.kind as WalKind, locator, full, raw, sha256(current), intent, auditId)
  }

  // -- shared --------------------------------------------------------------

  /**
   * Append the WAL entry, then make the new content visible.
   *
   * Order matters: the log records the intent before the rename, so a crash
   * between the two leaves a recoverable trace rather than a silent change.
   */
  private commit(
    kind: WalKind,
    locator: string,
    full: string,
    raw: string,
    previousHash: string | null,
    intent: MutationIntent,
    auditId: string,
  ): MutationResult {
    const newHash = sha256(raw)
    validateEntry({
      kind,
      locator,
      previousHash: previousHash as WalEntry["previousHash"],
      newHash: newHash as WalEntry["newHash"],
      source: intent.source,
      reason: intent.reason,
    })

    mkdirSync(dirname(full), { recursive: true })
    const tmp = `${full}.${auditId}.tmp`
    writeFileSync(tmp, raw, "utf8")

    try {
      this.appendWal({
        seq: this.nextSeq(),
        kind,
        locator,
        previousHash: previousHash as WalEntry["previousHash"],
        newHash: newHash as WalEntry["newHash"],
        auditId,
        source: intent.source,
        reason: intent.reason,
        timestamp: new Date().toISOString(),
      })
      renameSync(tmp, full)
    } catch (e) {
      // Leave no half-written file behind for the next scan to pick up.
      try {
        unlinkSync(tmp)
      } catch {
        // The temporary file is already gone; nothing further to undo.
      }
      throw e
    }

    return { applied: true, auditId }
  }

  private appendWal(entry: WalEntry): void {
    const file = join(this.root, WAL_FILE)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8")
  }

  /** Entries already recorded, so a restart continues the sequence. */
  private nextSeq(): number {
    const file = join(this.root, WAL_FILE)
    if (!existsSync(file)) return 1
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0)
    return lines.length + 1
  }

  /** The WAL as recorded, for recovery and for the audit trail. */
  readWal(): WalEntry[] {
    const file = join(this.root, WAL_FILE)
    if (!existsSync(file)) return []
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as WalEntry)
  }

  private refuseCredentials(body: string): void {
    const classified = classifyText(body)
    if (classified.classification === "secret") {
      throw KnowledgeFailure.mutationRefused(
        `refusing to write credential content into the vault: ${classified.reason}`,
      )
    }
  }

  private assertCas(current: string, expected?: string): void {
    const observed = sha256(current)
    if (expected === undefined) {
      throw KnowledgeFailure.mutationRefused("this mutation requires expectedVersionHash")
    }
    if (expected !== observed) {
      throw KnowledgeFailure.casMismatch(expected, observed)
    }
  }

  /** Resolve a locator that must stay inside the vault once created. */
  private resolveWritable(locator: string): string {
    const full = join(this.root, locator)
    if (!wouldBeContained(this.realRoot, full)) {
      throw KnowledgeFailure.pathUnresolved(`locator escapes the vault root: ${locator}`)
    }
    return full
  }

  /** Find an existing note by id. */
  private locate(id?: KnowledgeId): { locator: string; full: string; raw: string } {
    if (id === undefined) {
      throw KnowledgeFailure.mutationRefused("this mutation requires targetId")
    }
    for (const locator of this.markdownLocators()) {
      const full = join(this.root, locator)
      if (!isContained(this.realRoot, full)) continue
      let raw: string
      try {
        raw = readFileSync(full, "utf8")
      } catch {
        continue
      }
      try {
        if (parseFrontmatter(raw).frontmatter.unifia_id === id) return { locator, full, raw }
      } catch {
        // A note that does not parse is not the target.
      }
    }
    throw KnowledgeFailure.sourceInconsistent(`no note with id ${id}`)
  }

  private markdownLocators(): string[] {
    // Reuse the reader's walk so writer and reader see the same corpus, with
    // the same containment rules and the same skipped directories.
    return new VaultSource({
      root: this.root,
      space: { kind: "personal", id: "writer", label: "writer" },
    }).locators()
  }
}

/** UUIDv7: 48-bit big-endian timestamp, version 7, variant 10. */
function randomUUIDv7(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const ms = BigInt(Date.now())
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
