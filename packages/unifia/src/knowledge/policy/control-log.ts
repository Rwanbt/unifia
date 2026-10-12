/* SPDX-License-Identifier: MIT */
/**
 * Persistent Class C control log (ADR-KNOW-0006 §6, R-0012, R-0015).
 *
 * The in-memory audit closed "every decision is emitted". It did not close
 * "every decision is auditable": the trail died with the process, so nobody
 * could answer *did this note ever leave?* after a crash, a restart, or an
 * incident. For a product whose central invariant is sovereignty, a
 * non-persistent trail is not a V2 nicety — it is the control that makes the
 * invariant checkable at all.
 *
 * ## What is recorded, and what is not
 *
 * An entry carries the content **hash**, the destination, the decision, the
 * reason, the guard version and a timestamp. It never carries the note body,
 * a snippet, a token, or a locator: a log that quotes what it refused to
 * release would leak exactly what the guard withheld. The hash is enough to
 * answer "did *this* content go there", which is the question an audit has
 * to answer.
 *
 * ## Why it batches, stated plainly
 *
 * The first version fsynced every entry. Measured on the development
 * machine that is **10.9 ms per decision**, and `backlinks()` takes one
 * decision per note in the vault — eleven seconds of audit on a thousand
 * notes. An audit that slow is an audit an operator turns off, which is
 * strictly worse than a bounded window.
 *
 * So entries buffer and a `flush()` writes the batch in one durable append.
 * The cost is explicit: **a crash loses at most the entries since the last
 * flush** — the current request's, at most `FLUSH_AT_ENTRIES` of them. That
 * window is the price of a trail that is actually kept. Callers flush at
 * request boundaries; `flushOnExit` covers an orderly shutdown.
 *
 * What is *not* traded away: a flush is a single fsynced append, so an entry
 * that reached disk is on the physical device, and a torn tail cannot
 * corrupt the next batch (`appendLineDurable` re-separates).
 *
 * ## Generations: bounded, chained, and checkable
 *
 * The trail is a set of generations (layout in `control-log-generations.ts`,
 * rotation in `control-log-rotation.ts`). Two limits bound it:
 *
 * - `ROTATE_AT_BYTES` (8 MiB): a generation that has reached the limit is
 *   sealed before the next batch is appended. A batch is at most
 *   `FLUSH_AT_ENTRIES` lines, 27 KB at the longest line the guard can write
 *   (a grant's reason), so a generation is at most 8.4 MB.
 * - `CONTROL_LOG_GENERATIONS` (6): the active generation and five archives.
 *   The oldest is removed only once a newer one is in place, so the trail
 *   holds at most 6 × 8.4 MB ≈ 50 MB (48 MiB) per workspace.
 *
 * Measured with the guard's own reason strings, a decision line is 316 bytes
 * on average (435 bytes at the worst). A generation therefore holds about
 * 26,600 decisions (19,300 at the worst line). Retention is by count and size,
 * not by age: once the trail has rotated, a reader always sees the five sealed
 * generations, about 133,000 decisions (96,000 at the worst line), and up to
 * about 160,000 when the active one is full. How many days that is depends on
 * the traffic, which the repository does not measure: at an assumed 1,000
 * decisions a day, the guaranteed window is about four months.
 *
 * Every entry carries a sequence number and the hash of the entry before it,
 * and every generation records its first sequence and the hash it continues
 * from. A reader checks the chain across the generations in order and treats a
 * gap, a mismatch or a missing middle generation as an error: it refuses to
 * answer rather than answer as if the hole were not there.
 *
 * ## What is not promised
 *
 * No absolute durability. A power loss, or a process killed before its flush,
 * loses the entries that were accepted but not yet written: at most the
 * `FLUSH_AT_ENTRIES - 1` decisions buffered since the last flush, and any batch
 * whose append had not reached the disk. A crash during a rotation is recovered
 * on the next write without losing any written entry. The verifier cannot see
 * an edit to the last entry of the newest generation, or the deletion of that
 * generation, without a head recorded elsewhere: `verify()` reports the head
 * hash so an owner can keep it.
 */

import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import type { DomainBus, DomainEvent } from "../events/bus.js"
import { WriteLock } from "../mutation/durability.js"
import type { EgressAudit, EgressAuditEntry } from "./audit.js"
import {
  LOCK_NAME,
  readVerifiedTrail,
  trailFailure,
  type TrailReport,
  type VerifiedTrail,
} from "./control-log-generations.js"
import { appendBatch, type RotationStep, type WriterHooks, type WriterLimits } from "./control-log-rotation.js"

export type { RotationStep } from "./control-log-rotation.js"

/** Where the control log lives inside a workspace. */
export const CONTROL_LOG_FILE = ".unifia/control-log.jsonl"

/** Flush once the buffer reaches this, so the window stays bounded. */
export const FLUSH_AT_ENTRIES = 64

/**
 * Rotate past this size. See the module comment for the arithmetic.
 *
 * An append-only log that nothing bounds fills the disk and, worse, becomes
 * too slow to read — an audit nobody can open is not an audit.
 */
export const ROTATE_AT_BYTES = 8 * 1024 * 1024

/**
 * How many generations are kept, the active one included. The oldest is removed
 * only after the new set is in place. Erasing an audit trail is not something
 * this module decides on its own; the bound is what it does decide.
 */
export const CONTROL_LOG_GENERATIONS = 6

export interface ControlLogReadOptions {
  /** Only entries at or after this ISO-8601 instant. */
  since?: string
  /** Only decisions of this kind. */
  decision?: "allow" | "deny"
  /** Only entries about this content hash. */
  hash?: string
}

/** Limits and hooks. The defaults are the documented ones; tests set small limits to cycle quickly. */
export interface ControlLogOptions {
  rotateAtBytes?: number
  generations?: number
  /** Called at each point a rotation can be interrupted. A hook that throws simulates a crash there. */
  onRotationStep?: (step: RotationStep) => void
}

/**
 * Audit sink that writes to disk and emits on the bus.
 *
 * Bus emission is immediate — a subscriber watching decisions live must not
 * wait for a flush. Only the durable write batches.
 */
export class PersistentEgressAudit implements EgressAudit {
  private readonly pending: EgressAuditEntry[] = []
  private readonly limits: WriterLimits
  private readonly hooks: WriterHooks
  private readonly lock: WriteLock
  private exitHookInstalled = false
  private failure: Error | null = null

  constructor(
    private readonly workspaceRoot: string,
    private readonly bus?: DomainBus,
    options: ControlLogOptions = {},
  ) {
    this.limits = {
      rotateAtBytes: options.rotateAtBytes ?? ROTATE_AT_BYTES,
      generations: Math.max(2, options.generations ?? CONTROL_LOG_GENERATIONS),
    }
    this.hooks = options.onRotationStep === undefined ? {} : { onRotationStep: options.onRotationStep }
    this.lock = new WriteLock(join(this.trailDir, LOCK_NAME))
  }

  get file(): string {
    return join(this.workspaceRoot, CONTROL_LOG_FILE)
  }

  private get trailDir(): string {
    return dirname(this.file)
  }

  record(entry: EgressAuditEntry): void {
    // A trail that has stopped recording must stop the traffic it cannot
    // describe. Serving content while unable to say where it went is the
    // precise failure this module exists to prevent, so a broken log is a
    // loud error rather than a silent degradation.
    if (this.failure !== null) {
      throw new Error(`egress control log is unwritable: ${this.failure.message}`)
    }
    this.pending.push(entry)
    if (this.pending.length >= FLUSH_AT_ENTRIES) {
      try {
        this.flush()
      } catch (error) {
        // The record that triggered the write is not claimed: it is refused,
        // and it reaches neither the batch nor the bus.
        this.withdraw(entry)
        throw error
      }
    }
    this.emit(entry)
  }

  /** Entries recorded but not yet on disk. */
  get pendingCount(): number {
    return this.pending.length
  }

  /**
   * Write everything buffered, in one fsynced append, after any rotation the
   * active generation needs.
   *
   * Idempotent and safe to call when nothing is pending, so a caller can put
   * it at the end of every request without checking. A failure keeps the batch
   * pending and makes the sink refuse further records.
   */
  flush(): void {
    if (this.pending.length === 0) return
    const batch = this.pending.slice()
    this.commit(batch)
    this.pending.splice(0, batch.length)
  }

  /** Set once a write has failed; the sink refuses to record after that. */
  get broken(): Error | null {
    return this.failure
  }

  /**
   * Flush when the process ends normally.
   *
   * `exit` only, and only synchronous work: a hook that promises to catch a
   * `SIGKILL` or a power loss would be a false guarantee. The bounded window
   * documented above is the real one.
   *
   * Registration goes through one shared listener rather than one per sink:
   * a long-lived daemon composes a service per workspace, and a listener each
   * would trip Node's max-listeners warning and then leak them.
   */
  flushOnExit(): void {
    if (this.exitHookInstalled) return
    this.exitHookInstalled = true
    registerForExitFlush(this)
  }

  /**
   * Read the trail back, oldest first, including anything still buffered.
   *
   * Reads every retained generation in order. A trail with a gap or a
   * mismatch is an error, not a shorter answer. A line that does not parse
   * is skipped, as a torn tail is.
   */
  entries(options: ControlLogReadOptions = {}): EgressAuditEntry[] {
    const trail = this.readTrail()
    return [...trail.entries, ...this.pending].filter((entry) => matches(entry, options))
  }

  /** How many decisions went each way over the whole trail. */
  tally(options: ControlLogReadOptions = {}): { allow: number; deny: number } {
    let allow = 0
    let deny = 0
    for (const e of this.entries(options)) {
      if (e.decision === "allow") allow += 1
      else deny += 1
    }
    return { allow, deny }
  }

  /**
   * Answer the question an audit exists for: did this content ever leave,
   * and where to.
   */
  destinationsFor(
    hash: string,
  ): Array<{ destination: string; decision: "allow" | "deny"; timestamp: string }> {
    return this.entries({ hash }).map((e) => ({
      destination: e.destination,
      decision: e.decision,
      timestamp: e.timestamp,
    }))
  }

  /**
   * Check the trail on disk: the sequence range, the generations, the chain
   * and the size. Read-only: it writes nothing, creates nothing, and repairs
   * nothing, and it reports a finding rather than raising one.
   */
  verify(): TrailReport {
    return readVerifiedTrail(this.trailDir, this.limits.generations).report
  }

  private readTrail(): VerifiedTrail {
    const verified = readVerifiedTrail(this.trailDir, this.limits.generations)
    if (!verified.report.ok) throw trailFailure(verified.report)
    return verified
  }

  /** Write the batch under the write lock. A busy lock is transient; any other failure is final. */
  private commit(batch: readonly EgressAuditEntry[]): void {
    try {
      this.lock.acquire()
    } catch {
      throw new Error("the egress control log is held by another writer; the decisions are still pending")
    }
    try {
      appendBatch(this.trailDir, batch, this.limits, this.hooks)
    } catch {
      // Named by no path: the operating system's message would carry the absolute path of the vault, and this error reaches
      // the model through the tools that flush the trail.
      this.failure = new Error("the egress control log cannot be written")
      throw this.failure
    } finally {
      this.lock.release()
    }
  }

  private withdraw(entry: EgressAuditEntry): void {
    const index = this.pending.lastIndexOf(entry)
    if (index !== -1) this.pending.splice(index, 1)
  }

  private emit(entry: EgressAuditEntry): void {
    if (this.bus === undefined) return
    const event: DomainEvent = {
      id: randomUUID(),
      kind: "egress.decision",
      timestamp: entry.timestamp,
      payload: {
        hash: entry.hash,
        destination: entry.destination,
        decision: entry.decision,
        reason: entry.reason,
        guardVersion: entry.guardVersion,
      },
    }
    this.bus.emit(event)
  }
}

/**
 * Sinks to flush at exit, held weakly.
 *
 * A strong set would keep every composition alive for the life of the
 * process — the audit trail is not a reason to leak the vault it describes.
 */
const exitFlushSet = new Set<WeakRef<PersistentEgressAudit>>()
let exitHook: (() => void) | null = null

function registerForExitFlush(sink: PersistentEgressAudit): void {
  exitFlushSet.add(new WeakRef(sink))
  if (exitHook !== null) return
  exitHook = () => {
    for (const ref of exitFlushSet) {
      try {
        ref.deref()?.flush()
      } catch {
        // Nothing useful can be reported from an exit handler, and throwing
        // here would mask the real reason the process is ending.
      }
    }
  }
  process.on("exit", exitHook)
}

function matches(entry: EgressAuditEntry, options: ControlLogReadOptions): boolean {
  if (options.decision !== undefined && entry.decision !== options.decision) return false
  if (options.hash !== undefined && entry.hash !== options.hash) return false
  if (options.since !== undefined && entry.timestamp < options.since) return false
  return true
}
