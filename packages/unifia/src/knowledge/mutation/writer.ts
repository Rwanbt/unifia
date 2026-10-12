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
 * `delete` removes the note from the vault the way Obsidian does: it leaves
 * its locator and moves to `.unifia/trash/`, recorded in the WAL and
 * restorable by audit id. P10 forbids a *silent* destructive operation, and
 * a recorded reversible move is neither — see the ADR-KNOW-0009 amendment of
 * 2026-08-30. `archive` remains distinct: it retires a note from retrieval
 * without removing it from the vault.
 */

import { assertVaultRootInside } from "../app/project-boundary.js"
import { existsSync, lstatSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { dirname, isAbsolute, join, relative } from "node:path"
import type {
  MutationIntent,
  MutationResult,
  KnowledgeId,
  KnowledgeLocator,
  KnowledgeVersionHash,
  NoteFrontmatter,
} from "@unifia/contracts/knowledge"
import { MutationIntentSchema, portableRestrictionsToFrontmatter } from "@unifia/contracts/knowledge"
import { KnowledgeFailure } from "../domain/errors.js"
import { parseFrontmatter, serialiseNote } from "../parser/frontmatter.js"
import { classifyText } from "../context/dataflow.js"
import { isContained, wouldBeContained, realOrNull } from "../source/containment.js"
import { readContainedByHandleSync, VaultSource } from "../source/vault.js"
import { isTransitionAllowed } from "../memory/lifecycle.js"
import type { WalEntry, WalKind } from "../wal/wal.js"
import { validateEntry } from "../wal/wal.js"
import type { MutationWriter } from "../facade/service.js"
import {
  TMP_SUFFIX,
  WriteLock,
  appendLineDurable,
  ensureFolder,
  fsyncDirectory,
  hasRecoveryWork,
  isInternalLocator,
  isWindowsDeviceName,
  readNoFollow,
  readWalTolerant,
  recover,
  renameDurable,
  writeNewFileDurable,
  type RecoveryReport,
} from "./durability.js"

/** Where the append-only write-ahead log lives. */
export const WAL_FILE = ".unifia/wal.jsonl"

/** Serialises writers within and across processes. */
export const LOCK_FILE = ".unifia/write.lock"

/**
 * Where deleted notes go.
 *
 * Obsidian's default is a trash folder inside the vault, and that is the
 * behaviour V1 implements: a delete is reversible until the trash is emptied.
 * Emptying it is a separate, explicit operation — the only one that actually
 * destroys, and the one P10 asks the operator to confirm.
 */
export const TRASH_DIR = ".unifia/trash"

/** One entry in the trash. */
export interface TrashedNote {
  /** Where the note lived before it was deleted. */
  locator: string
  /** Audit id of the deletion; the handle a restore is addressed by. */
  auditId: string
  deletedAt: string
}

export interface VaultMutationWriterConfig {
  /** Absolute path to the vault root that receives the writes. */
  root: string
  /** Where new notes are created when the intent gives no locator. */
  inboxSubdir?: string
  /**
   * Reconcile the vault against its WAL on open. Defaults to true; only a
   * test that wants to observe an unrecovered state turns it off.
   */
  recoverOnOpen?: boolean
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex")
}

/**
 * Whether anything is at `path`, a dangling link included. `existsSync` follows a link, so a dangling one reads as
 * absent, and a create or a move onto it would replace the link, or write through it to its target.
 */
function entryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** A recovery that found nothing to do, or was left to a live holder of the write lock. */
function emptyRecovery(): RecoveryReport {
  return { completed: [], discarded: [], conflicts: [], truncatedWalLines: 0 }
}

/** The internal paths the writer reads or writes, relative to the vault root. Each must stay inside the root. */
const WRITER_INTERNAL_PATHS = [
  ".unifia",
  WAL_FILE,
  LOCK_FILE,
  ".unifia/policy.json",
  ".unifia/policy.json.tmp",
  ".unifia/control-log.jsonl",
  TRASH_DIR,
]

/** The hash of a trashed note's bytes, read without following a link. Null when the entry is not a file of its own. */
function contentHashOf(path: string): string | null {
  const read = readNoFollow(path)
  return read.kind === "file" ? sha256(read.text) : null
}

/** The locator a trash sidecar names, or null when the sidecar is not an object with a string locator. */
function trashLocatorOf(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    const locator = (parsed as { locator?: unknown }).locator
    return typeof locator === "string" ? locator : null
  } catch {
    return null
  }
}

/** The ids the writer gives to its trash entries: a random UUID, never a path. */
const AUDIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class VaultMutationWriter implements MutationWriter {
  private readonly root: string
  private readonly realRoot: string
  private readonly inbox: string
  private readonly lock: WriteLock
  private readonly lastRecovery: RecoveryReport

  constructor(config: VaultMutationWriterConfig) {
    if (!isAbsolute(config.root)) {
      throw KnowledgeFailure.pathUnresolved("vault root must be absolute")
    }
    const real = realOrNull(config.root)
    if (real === null) {
      throw KnowledgeFailure.pathUnresolved("vault root cannot be resolved")
    }
    // The writer reads and writes its internal paths itself, so it refuses a root whose internal paths lead outside it, even
    // when a caller did not compose the vault first. The composition checks the same paths; this is the writer's own guard.
    for (const internal of WRITER_INTERNAL_PATHS) assertVaultRootInside(config.root, join(config.root, internal))
    this.root = config.root
    this.realRoot = real
    this.inbox = config.inboxSubdir ?? "inbox"
    this.lock = new WriteLock(join(config.root, LOCK_FILE))

    // Reconcile before the first write. A vault opened after a crash must not
    // be extended on top of an unfinished commit.
    this.lastRecovery = config.recoverOnOpen === false ? emptyRecovery() : this.reconcileOnOpen()
  }

  /**
   * Reconcile the vault with its WAL before the first write, under the write lock.
   *
   * A live holder keeps the lock, and recovery is left to it: nothing beside its in-flight commit is completed or discarded. A
   * dead holder's lock is reclaimed here, and that reclaim is the only sign that a writer died mid-commit, so the move-source
   * pass runs only then. The release at the end removes the lock file, so the crash marker is consumed once and later opens do
   * not repeat the pass.
   */
  private reconcileOnOpen(): RecoveryReport {
    if (!hasRecoveryWork(this.root, WAL_FILE, LOCK_FILE)) return emptyRecovery()
    let acquired: { reclaimed: boolean }
    try {
      acquired = this.lock.acquire()
    } catch {
      return emptyRecovery()
    }
    try {
      return recover(this.root, WAL_FILE, { afterCrash: acquired.reclaimed })
    } finally {
      this.lock.release()
    }
  }

  /**
   * The internal paths are checked at every operation, not only when the writer was built: a link can appear inside the
   * vault after that. A path that leads outside the vault is refused without a path in the message.
   */
  private assertInternalPathsInside(): void {
    for (const internal of WRITER_INTERNAL_PATHS) assertVaultRootInside(this.root, join(this.root, internal))
  }

  /** What the opening reconciliation did, for `doctor` and for tests. */
  recovery(): RecoveryReport {
    return this.lastRecovery
  }

  async apply(input: {
    intent: unknown
    reason: string
    source: string
  }): Promise<MutationResult> {
    this.assertInternalPathsInside()
    const parsed = MutationIntentSchema.safeParse(input.intent)
    if (!parsed.success) {
      throw KnowledgeFailure.mutationRefused(
        `invalid mutation intent: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      )
    }
    const intent = parsed.data as MutationIntent

    const auditId = randomUUID()
    switch (intent.kind) {
      case "create":
        return this.create(intent, auditId)
      case "update":
        return this.update(intent, auditId)
      case "move":
        return this.move(intent, auditId)
      case "delete":
        return this.remove(intent, auditId)
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

  private async create(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const content = intent.newContent
    if (content === undefined) {
      throw KnowledgeFailure.mutationRefused("create requires newContent")
    }
    this.refuseCredentials(content.body)

    const locator = intent.targetLocator ?? `${this.inbox}/${auditId}.md`
    const full = this.resolveWritable(locator)
    if (entryExists(full)) {
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

  private async update(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const content = intent.newContent
    if (content === undefined) {
      throw KnowledgeFailure.mutationRefused("update requires newContent")
    }
    this.refuseCredentials(content.body)

    const { locator, full, raw: current } = await this.locate(intent.targetId)
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

  private async transition(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const { locator, full, raw: current } = await this.locate(intent.targetId)
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

    if (intent.kind === "supersede") {
      return await this.supersede(intent, auditId, { locator, full, current, next, note })
    }

    const raw = serialiseNote({ frontmatter: next, body: note.body, raw: current })
    return this.commit(intent.kind as WalKind, locator, full, raw, sha256(current), intent, auditId)
  }

  /**
   * Mark `targetId` superseded and record the reference on its successor.
   *
   * This touches two files. `successorId` used to be validated by the schema
   * and then ignored: the target's own list was copied back onto itself, so
   * nothing recorded the replacement and the successor never learned it had
   * one.
   *
   * The whole operation runs under a single write lock and re-validates
   * both notes just before the writes land: the target's CAS hash against
   * `expectedVersionHash`, and the successor's current content (re-read
   * inside the lock) for the cycle check and for the bytewise content we
   * are about to rewrite. A second writer that slips in between the plan
   * and the apply produces a `cas_mismatch` whose message names both
   * notes, so the operator can see the conflict instead of having one
   * supersession silently overwrite another.
   *
   * The order is chosen so the recoverable state is the tolerable one: the
   * successor gains its reference first, then the target is marked. A
   * crash in between leaves a successor claiming to replace a still-active
   * note — visible to `doctor` and repairable — rather than a superseded
   * note nothing points at. Both writes share one auditId so the WAL
   * identifies them as one operation.
   */
  private async supersede(
    intent: MutationIntent,
    auditId: string,
    target: {
      locator: string
      full: string
      current: string
      next: NoteFrontmatter
      note: ReturnType<typeof parseFrontmatter>
    },
  ): Promise<MutationResult> {
    const successorId = intent.successorId
    if (successorId === undefined) {
      throw KnowledgeFailure.mutationRefused("supersede requires successorId")
    }
    const targetIdValue = intent.targetId
    if (targetIdValue === undefined) {
      throw KnowledgeFailure.mutationRefused("supersede requires targetId")
    }
    if (successorId === targetIdValue) {
      throw KnowledgeFailure.mutationRefused("a note cannot supersede itself")
    }

    // One lock for the whole multi-file write. The plan reads target and
    // successor outside the lock to keep the slow path off the critical
    // section; the actual re-validation and the two commits happen under
    // it, so nothing can change between the checks and the writes.
    return this.lock.withLock(() => {
      // Both notes may carry a leftover temporary: it completes before either is read, so the checks see the committed bytes.
      this.completeLeftoverTemporaries()
      // Re-read the target inside the lock: it may have moved, been
      // edited, or been superseded since the plan read it.
      let lockedTarget: { locator: string; full: string; raw: string }
      try {
        lockedTarget = this.locateSync(targetIdValue)
      } catch (e) {
        if (
          e instanceof KnowledgeFailure &&
          (e.kind === "source_inconsistent" || e.kind === "path_unresolved")
        ) throw e
        throw KnowledgeFailure.casMismatch(
          "target present",
          `target missing: ${(e as Error).message}`,
        )
      }
      const lockedTargetHash = sha256(lockedTarget.raw)
      if (lockedTargetHash !== intent.expectedVersionHash) {
        throw KnowledgeFailure.casMismatch(
          intent.expectedVersionHash ?? "(unspecified)",
          lockedTargetHash,
        )
      }
      if (lockedTarget.locator !== target.locator) {
        throw KnowledgeFailure.casMismatch(
          target.locator,
          `target relocated to ${lockedTarget.locator}`,
        )
      }

      // Re-read the successor inside the lock: the schema carries no
      // expected hash for it, so we verify the file still exists, parses,
      // and has not gained a supersession cycle we are about to create.
      let lockedSuccessor: { locator: string; full: string; raw: string }
      try {
        lockedSuccessor = this.locateSync(successorId as KnowledgeId)
      } catch (e) {
        if (
          e instanceof KnowledgeFailure &&
          (e.kind === "source_inconsistent" || e.kind === "path_unresolved")
        ) throw e
        throw KnowledgeFailure.casMismatch(
          "successor present",
          `successor missing: ${(e as Error).message}`,
        )
      }
      const successorNote = parseFrontmatter(lockedSuccessor.raw)
      const targetId = targetIdValue as string
      if (successorNote.frontmatter.unifia_supersedes.includes(targetId)) {
        throw KnowledgeFailure.mutationRefused(
          `supersession cycle: ${targetId} already in successor ${successorId}.unifia_supersedes`,
        )
      }
      if (target.note.frontmatter.unifia_supersedes.includes(successorId)) {
        throw KnowledgeFailure.mutationRefused(
          `supersession cycle: ${targetId} already supersedes ${successorId}`,
        )
      }

      if (!successorNote.frontmatter.unifia_supersedes.includes(targetId)) {
        const successorNext: NoteFrontmatter = {
          ...successorNote.frontmatter,
          unifia_supersedes: [...successorNote.frontmatter.unifia_supersedes, targetId],
          unifia_updated_at: new Date().toISOString(),
        }
        const successorRaw = serialiseNote({
          frontmatter: successorNext,
          body: successorNote.body,
          raw: lockedSuccessor.raw,
        })
        this.commit(
          "update",
          lockedSuccessor.locator,
          lockedSuccessor.full,
          successorRaw,
          sha256(lockedSuccessor.raw),
          intent,
          auditId,
        )
      }

      const raw = serialiseNote({
        frontmatter: target.next,
        body: target.note.body,
        raw: target.current,
      })
      return this.commit(
        "supersede",
        target.locator,
        target.full,
        raw,
        sha256(target.current),
        intent,
        auditId,
      )
    })
  }

  /**
   * Remove a note from the vault, recorded and reversible.
   *
   * This is Obsidian's default meaning of "delete": the note leaves its
   * locator — gone from listings, retrieval and backlinks — and moves to a
   * trash folder rather than being unlinked. ADR-KNOW-0009's amendment of
   * 2026-08-30 records the decision: what P10 forbids is a *silent*
   * destructive operation, and a WAL-recorded, restorable move is neither
   * silent nor destructive.
   *
   * The WAL entry carries `newHash: null` because no content remains at the
   * locator — the existing invariant holds unchanged.
   */
  private async remove(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const { locator, full, raw: current } = await this.locate(intent.targetId)
    this.assertCas(current, intent.expectedVersionHash)

    const trashed = join(this.root, TRASH_DIR, `${auditId}.md`)

    return this.lock.withLock(() => {
      // A leftover temporary is a committed write whose rename did not land. It completes before the note is checked, so the
      // bytes trashed are the bytes the log says the note holds, and a plan made on the previous bytes is refused.
      this.completeLeftoverTemporary(full)
      this.assertHashAt(full, sha256(current))
      ensureFolder(dirname(trashed))

      // The sidecar records where it came from, so a restore does not have to
      // parse the WAL to know the destination. Both names carry a fresh id, so an
      // exclusive create is the only write that can happen here: anything already
      // at those names is refused, never written through.
      writeNewFileDurable(
        `${trashed}.origin.json`,
        JSON.stringify({ locator, auditId, deletedAt: new Date().toISOString() }, null, 2),
      )
      writeNewFileDurable(trashed, current)

      appendLineDurable(
        join(this.root, WAL_FILE),
        JSON.stringify({
          seq: this.nextSeq(),
          kind: "delete",
          locator,
          previousHash: sha256(current) as WalEntry["previousHash"],
          newHash: null,
          auditId,
          source: intent.source,
          reason: intent.reason,
          timestamp: new Date().toISOString(),
        } satisfies WalEntry),
      )

      // Only now does the note leave the vault: the copy and the record are
      // already durable, so a crash here loses nothing.
      unlinkSync(full)
      fsyncDirectory(dirname(full))

      const written = parseFrontmatter(current).frontmatter
      return {
        applied: true,
        auditId,
        ref: {
          id: written.unifia_id as KnowledgeId,
          locator: locator as KnowledgeLocator,
          versionHash: sha256(current) as KnowledgeVersionHash,
        },
      }
    })
  }

  /** What is in the trash, newest first. */
  trash(): TrashedNote[] {
    this.assertInternalPathsInside()
    const dir = join(this.root, TRASH_DIR)
    if (!existsSync(dir)) return []
    const out: TrashedNote[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".origin.json")) continue
      try {
        const read = readNoFollow(join(dir, name))
        if (read.kind !== "file") continue
        const meta = JSON.parse(read.text) as {
          locator: string
          auditId: string
          deletedAt: string
        }
        // The id names the trashed file and is used to erase it, so only an id the writer gave, under its own file name, is
        // an entry. A sidecar that names another path is not listed, and so cannot be erased or restored.
        if (!AUDIT_ID.test(meta.auditId) || name !== `${meta.auditId}.md.origin.json`) continue
        out.push(meta)
      } catch {
        // A sidecar we cannot read is not a restorable entry.
      }
    }
    out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    return out
  }

  /**
   * Permanently destroy trashed notes. The only operation that truly erases.
   *
   * Deletion is reversible until this runs, which is what makes the delete
   * safe — and what makes this one dangerous. P10 asks for a confirmation
   * exactly here: `confirm` is required and must be `true`, so no caller
   * empties the trash by passing an options object it did not think about.
   *
   * The purge itself is recorded in the WAL. An erasure that left no trace
   * would be the silent destructive operation P10 forbids, only one level
   * further down.
   */
  async emptyTrash(options: {
    confirm: true
    /** Only destroy entries deleted more than this many days ago. */
    olderThanDays?: number
    /** Only destroy this one entry. */
    auditId?: string
    source?: string
  }): Promise<{ destroyed: TrashedNote[]; kept: TrashedNote[] }> {
    if (options.confirm !== true) {
      throw KnowledgeFailure.mutationRefused(
        "emptyTrash permanently destroys notes and requires confirm: true",
      )
    }

    const cutoff =
      options.olderThanDays === undefined
        ? undefined
        : Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000

    this.assertInternalPathsInside()
    const destroyed: TrashedNote[] = []
    const kept: TrashedNote[] = []

    for (const entry of this.trash()) {
      const selected =
        (options.auditId === undefined || options.auditId === entry.auditId) &&
        (cutoff === undefined || Date.parse(entry.deletedAt) < cutoff)
      if (!selected) {
        kept.push(entry)
        continue
      }
      destroyed.push(entry)
    }

    if (destroyed.length === 0) return { destroyed, kept }

    this.lock.withLock(() => {
      for (const entry of destroyed) {
        const trashed = join(this.root, TRASH_DIR, `${entry.auditId}.md`)
        // Record before destroying: the trace has to outlive the content.
        appendLineDurable(
          join(this.root, WAL_FILE),
          JSON.stringify({
            seq: this.nextSeq(),
            kind: "delete",
            locator: entry.locator,
            previousHash: contentHashOf(trashed) as WalEntry["previousHash"],
            newHash: null,
            auditId: `purge-${entry.auditId}`,
            source: options.source ?? "operator",
            reason: `permanent erasure of ${entry.locator}`,
            timestamp: new Date().toISOString(),
          } satisfies WalEntry),
        )
        try {
          unlinkSync(trashed)
          unlinkSync(`${trashed}.origin.json`)
        } catch {
          // Already gone; the record stands either way.
        }
      }
    })

    return { destroyed, kept }
  }

  /**
   * Put a deleted note back where it came from.
   *
   * Refuses when something already occupies the locator: restoring must not
   * overwrite work done since the deletion.
   *
   * The destination commit and the trash cleanup share one lock. The WAL
   * records `previousLocator` (the trash path) so a crash between the
   * two is recovered: the trashed copy is removed the next time the
   * vault is opened, and the restored copy is never overwritten by a
   * later restore.
   */
  async restoreDeleted(auditId: string): Promise<MutationResult> {
    this.assertInternalPathsInside()
    // The id names a file in the trash, and the WAL records that file's path for recovery. Only an id the writer gave can
    // name one: anything else, such as `../`, would read and later unlink a file outside the trash.
    if (!AUDIT_ID.test(auditId)) {
      throw KnowledgeFailure.sourceInconsistent("nothing in the trash for this audit id")
    }
    const trashed = join(this.root, TRASH_DIR, `${auditId}.md`)
    const sidecar = `${trashed}.origin.json`
    // Both files are read without following a link: a link planted in the trash would otherwise supply the note's bytes and
    // the place they go to, from outside the vault.
    const metaText = readNoFollow(sidecar)
    const rawText = readNoFollow(trashed)
    if (metaText.kind !== "file" || rawText.kind !== "file") {
      throw KnowledgeFailure.sourceInconsistent(`nothing in the trash for audit ${auditId}`)
    }
    // The sidecar names the note's locator. A sidecar that is not an object with a string locator is not a trash entry: it is
    // refused as a missing one, rather than read through.
    const locator = trashLocatorOf(metaText.text)
    if (locator === null) {
      throw KnowledgeFailure.sourceInconsistent(`nothing in the trash for audit ${auditId}`)
    }
    const raw = rawText.text
    const destination = this.resolveWritable(locator)
    // A leftover temporary at the destination is a committed write whose rename did not land: it completes before the check.
    this.lock.withLock(() => this.completeLeftoverTemporary(destination))
    if (entryExists(destination)) {
      throw KnowledgeFailure.casMismatch("absent", "present")
    }

    const restoreId = randomUUID()
    // The trash path, relative to the vault root, is the source the WAL
    // records. Recovery uses it to clean up after a mid-restore crash.
    const previousLocator = join(TRASH_DIR, `${auditId}.md`).replace(/\\/g, "/")
    const result = this.commit(
      "restore",
      locator,
      destination,
      raw,
      null,
      { ...({} as MutationIntent), reason: `restore of ${auditId}`, source: "trash" },
      restoreId,
      { previousLocator, previousFull: trashed },
    )
    // The sidecar is the trash's bookkeeping, not the note itself. Drop it
    // best-effort: a leftover sidecar is harmless and will be re-discovered
    // by `trash()` next time the vault is opened.
    try {
      unlinkSync(sidecar)
    } catch {
      // Already gone.
    }
    return result
  }

  /**
   * Rename a note inside the vault.
   *
   * `move` was in the contract and reached `unsupported mutation kind` only
   * after dispatch, so a schema-valid intent failed for a reason the schema
   * could not express.
   *
   * The rename is one logical commit: the destination is written and the
   * previous path is unlinked under the same lock, and the WAL records
   * `previousLocator` so a crash anywhere in that span is recoverable.
   */
  private async move(intent: MutationIntent, auditId: string): Promise<MutationResult> {
    const destination = intent.targetLocator
    if (destination === undefined) {
      throw KnowledgeFailure.mutationRefused("move requires targetLocator")
    }
    const { locator, full, raw: current } = await this.locate(intent.targetId)
    this.assertCas(current, intent.expectedVersionHash)

    const destinationFull = this.resolveWritable(destination)
    if (entryExists(destinationFull)) {
      throw KnowledgeFailure.casMismatch("absent", "present")
    }

    // The content is unchanged; only its locator moves. Both halves run
    // under one lock, and the WAL names the source so recovery can finish
    // the unlink if the process is killed in between.
    return this.commit(
      "move",
      destination,
      destinationFull,
      current,
      sha256(current),
      intent,
      auditId,
      destinationFull === full ? undefined : { previousLocator: locator, previousFull: full },
    )
  }

  // -- shared --------------------------------------------------------------

  /**
   * Append the WAL entry, then make the new content visible.
   *
   * Order matters: the log records the intent before the rename, so a crash
   * between the two leaves a recoverable trace rather than a silent change.
   *
   * For renames (`move`/`restore`) the caller also passes a `cleanup` so the
   * previous path is unlinked under the same lock — and the WAL records
   * `previousLocator` so a crash before the unlink can still be recovered
   * by re-opening the vault.
   */
  private commit(
    kind: WalKind,
    locator: string,
    full: string,
    raw: string,
    previousHash: string | null,
    intent: MutationIntent,
    auditId: string,
    cleanup?: { previousLocator: string; previousFull: string },
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

    // One lock for the whole commit. Without it two writers can read the same
    // sequence number, and their appends interleave into a log whose order no
    // longer matches what happened on disk.
    this.lock.withLock(() => {
      this.completeLeftoverTemporary(full)
      // The source of a move or restore is a note too: its leftover completes before the check that it still holds the planned bytes.
      if (cleanup !== undefined) this.completeLeftoverTemporary(cleanup.previousFull)
      this.assertUnchangedUnderLock(full, previousHash, cleanup)
      ensureFolder(dirname(full))
      const tmp = `${full}${TMP_SUFFIX}`

      // 1. bytes on disk... The temporary is created exclusively: a link planted at its name
      // is refused, and the write never goes through it to an outside target.
      writeNewFileDurable(tmp, raw)
      try {
        // 2. ...then the intent, durably: this is the commit point.
        const entry: WalEntry = {
          seq: this.nextSeq(),
          kind,
          locator,
          previousHash: previousHash as WalEntry["previousHash"],
          newHash: newHash as WalEntry["newHash"],
          auditId,
          source: intent.source,
          reason: intent.reason,
          timestamp: new Date().toISOString(),
        }
        if (cleanup !== undefined) entry.previousLocator = cleanup.previousLocator
        appendLineDurable(join(this.root, WAL_FILE), JSON.stringify(entry))
      } catch (e) {
        // Nothing was recorded, so nothing happened: remove the temporary
        // rather than leaving a write recovery would have to guess about.
        try {
          unlinkSync(tmp)
        } catch {
          // Already gone.
        }
        throw e
      }

      // 3. make it visible, 4. and flush the directory entry.
      renameDurable(tmp, full)
      fsyncDirectory(dirname(full))

      // 5. drop the previous copy under the same lock, so a crash here
      // cannot leave two silent copies. Recovery also knows about
      // `previousLocator` and will finish the unlink if the process
      // crashed earlier in this method.
      if (cleanup !== undefined) {
        try {
          unlinkSync(cleanup.previousFull)
        } catch {
          // The previous copy is already gone; the destination has the
          // recorded hash, which is the state the WAL recorded.
        }
      }
    })

    // The contract declares ref and newLifecycle; returning only
    // { applied, auditId } left the caller unable to observe what it wrote.
    const written = parseFrontmatter(raw).frontmatter
    return {
      applied: true,
      auditId,
      ref: {
        id: written.unifia_id as KnowledgeId,
        locator: locator as KnowledgeLocator,
        versionHash: newHash as KnowledgeVersionHash,
      },
      newLifecycle: written.unifia_lifecycle,
    }
  }


  /** Entries already recorded, so a restart continues the sequence. */
  /**
   * Next sequence number, derived from the last durable entry.
   *
   * Read under the commit lock, so two writers cannot observe the same value.
   * Counting lines instead would let a torn final append shift every
   * subsequent number by one, silently desynchronising the log from what
   * actually happened on disk.
   */
  private nextSeq(): number {
    const { entries } = readWalTolerant(join(this.root, WAL_FILE))
    const last = entries.at(-1)
    return last === undefined ? 1 : last.seq + 1
  }

  /** The WAL as recorded, for recovery and for the audit trail. */
  readWal(): WalEntry[] {
    // Tolerant: an append interrupted by a power loss leaves a partial JSON
    // line, and refusing to read the log because of it would lose every entry
    // before it.
    return readWalTolerant(join(this.root, WAL_FILE)).entries
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

  /**
   * Re-check, under the write lock and before anything is written, the state a write was planned against. The plan read the
   * note before the lock was taken (locate), and another writer may have committed since. A changed note is refused, as a stale
   * expected hash is, instead of being overwritten by a commit that never saw the change.
   */
  private assertUnchangedUnderLock(full: string, previousHash: string | null, cleanup?: { previousFull: string }): void {
    if (cleanup === undefined && previousHash !== null) {
      this.assertHashAt(full, previousHash)
      return
    }
    // A create, or the destination of a move or a restore: nothing may be there yet.
    if (entryExists(full)) throw KnowledgeFailure.casMismatch("absent", "present")
    if (cleanup !== undefined && previousHash !== null) this.assertHashAt(cleanup.previousFull, previousHash)
  }

  /**
   * A temporary at the note's name is a commit whose rename did not land: its WAL line is recorded and its bytes are on disk.
   * The write that stages its own temporary at that name cannot proceed past it, so recovery completes it first, under the write
   * lock, and the write then checks the note as committed. Without it every later write to the note is refused until the next
   * open. A delete stages nothing at that name, so it neither needs this nor runs it.
   */
  private completeLeftoverTemporary(full: string): void {
    if (entryExists(`${full}${TMP_SUFFIX}`)) recover(this.root, WAL_FILE, { afterCrash: false })
  }

  /**
   * Complete every leftover temporary of the vault, under the lock. A check that reads several notes at once (supersede) uses it,
   * because the second note's leftover is not known until it is located, and the check must see both committed states.
   */
  private completeLeftoverTemporaries(): void {
    recover(this.root, WAL_FILE, { afterCrash: false })
  }

  /** Refuse unless the file at `path` still holds the bytes with hash `expected`. */
  private assertHashAt(path: string, expected: string): void {
    const observed = contentHashOf(path)
    if (observed !== expected) throw KnowledgeFailure.casMismatch(expected, observed ?? "absent")
  }

  /** Resolve a locator that must stay inside the vault once created. */
  private resolveWritable(locator: string): string {
    const full = join(this.root, locator)
    if (!wouldBeContained(this.realRoot, full)) {
      throw KnowledgeFailure.pathUnresolved(`locator escapes the vault root: ${locator}`)
    }
    // The vault's own folder is bookkeeping: no note is written there, whatever the locator resolves to.
    if (isInternalLocator(locator)) {
      throw KnowledgeFailure.mutationRefused(`locator is reserved for the vault's own bookkeeping: ${locator}`)
    }
    // A name Windows reserves for a device would be written to the device, not to a file.
    if (process.platform === "win32" && isWindowsDeviceName(locator.split(/[\\/]/).pop() ?? "")) {
      throw KnowledgeFailure.mutationRefused(`locator names a device on Windows: ${locator}`)
    }
    return full
  }

  /** Find an existing note by id. */
  private async locate(
    id?: KnowledgeId,
  ): Promise<{ locator: string; full: string; raw: string }> {
    if (id === undefined) {
      throw KnowledgeFailure.mutationRefused("this mutation requires targetId")
    }
    for (const locator of await this.markdownLocators()) {
      const full = join(this.root, locator)
      if (!isContained(this.realRoot, full)) continue
      // Judged by where the note really is: a link inside the vault can name a file outside it, and reading through it
      // would take that file's content into the vault.
      const real = realOrNull(full)
      if (real === null || !isContained(this.realRoot, real)) continue
      // A note that is not a regular file with one name is passed over, as the synchronous walk passes it over: a pipe is never
      // opened, and a note with a second name is not read.
      let stats: ReturnType<typeof statSync>
      try {
        stats = statSync(real)
      } catch {
        continue
      }
      if (!stats.isFile() || stats.nlink > 1) continue
      // Read through the handle-checked reader, as the walk reads. A changed identity is a refusal, not a missing note.
      let raw: string
      try {
        const contained = readContainedByHandleSync(real, locator)
        if (contained === null) continue
        raw = contained
      } catch (error) {
        if (error instanceof KnowledgeFailure && error.kind === "path_unresolved") throw error
        continue
      }
      let isTarget: boolean
      try {
        isTarget = parseFrontmatter(raw).frontmatter.unifia_id === id
      } catch {
        // A note that does not parse is not the target.
        continue
      }
      if (!isTarget) continue
      // The note's real place decides, not the path it was reached by: an in-vault alias can reach the vault's own folder, and
      // a write there is refused as resolveWritable refuses a locator in that folder.
      if (isInternalLocator(relative(this.realRoot, real))) {
        throw KnowledgeFailure.mutationRefused(`locator is reserved for the vault's own bookkeeping: ${locator}`)
      }
      return { locator, full, raw }
    }
    throw KnowledgeFailure.sourceInconsistent(`no note with id ${id}`)
  }

  /**
   * Synchronous version of `locate` for use inside the write lock.
   *
   * Multi-file mutations (currently `supersede`) need to re-read both
   * notes inside one critical section; making that section `async` would
   * let another writer observe the half-finished state. The walk here
   * is intentionally tiny — it only enumerates the locators the writer
   * itself has already written, which `VaultSource.locators()` would
   * re-discover on every call, so we cache the list in a single
   * synchronous walk instead.
   */
  private locateSync(id: KnowledgeId): { locator: string; full: string; raw: string } {
    return this.locateSyncInner(id, this.realRoot, this.root, "")
  }

  private locateSyncInner(
    id: KnowledgeId,
    realRoot: string,
    root: string,
    prefix: string,
  ): { locator: string; full: string; raw: string } {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      throw KnowledgeFailure.sourceInconsistent(`no note with id ${id}`)
    }
    for (const name of names) {
      if (name === ".git" || name === "node_modules" || name === ".unifia") continue
      const full = join(root, name)
      let stats: ReturnType<typeof statSync>
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        // A folder whose real place is outside the vault is not walked: its names and notes are not the vault's.
        const realDir = realOrNull(full)
        if (realDir === null || !isContained(realRoot, realDir)) continue
        // Nor is a folder that is the vault's own, reached through a link: it is bookkeeping, not a note's place.
        if (isInternalLocator(relative(realRoot, realDir))) continue
        try {
          return this.locateSyncInner(id, realRoot, full, prefix.length > 0 ? prefix + "/" + name : name)
        } catch {
          // Not in this subtree; keep looking.
        }
      } else if (name.endsWith(".md")) {
        if (!isContained(realRoot, full)) continue
        // A note with a second name is not the target of a write, and is passed over: it is not read, so it cannot stop the search.
        if (!stats.isFile() || stats.nlink > 1) continue
        const real = realOrNull(full)
        if (real === null || !isContained(realRoot, real)) continue
        if (isInternalLocator(relative(realRoot, real))) continue
        let raw: string
        try {
          const contained = readContainedByHandleSync(real, prefix.length > 0 ? prefix + "/" + name : name)
          if (contained === null) continue
          raw = contained
        } catch (error) {
          if (error instanceof KnowledgeFailure && error.kind === "path_unresolved") throw error
          continue
        }
        try {
          if (parseFrontmatter(raw).frontmatter.unifia_id === id) {
            // WHY the locator is carried through the walk instead of sliced
            // out of `full` by comparing lengths with realRoot: the
            // configured root and its real path can differ in form (drive
            // letter vs Volume-GUID on the CI runner), so a length-based
            // slice produced garbage such as ".md" and the supersede CAS
            // then saw a phantom "target relocated" (#79). The walk knows
            // the relative name structurally; walkMarkdown() pins the same
            // posix + NFC form for the reader.
            return { locator: (prefix.length > 0 ? prefix + "/" + name : name).normalize("NFC"), full, raw }
          }
        } catch {
          // A note that does not parse is not the target.
        }
      }
    }
    throw KnowledgeFailure.sourceInconsistent(`no note with id ${id}`)
  }

  private async markdownLocators(): Promise<string[]> {
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
