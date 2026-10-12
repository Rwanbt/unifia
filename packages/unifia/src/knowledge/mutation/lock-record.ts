/* SPDX-License-Identifier: MIT */
/**
 * What a write lock file says, and what can be concluded from it.
 *
 * Two formats are read. The current one (version 2) names the owner that took the lock, the process and its start time, the boot,
 * the host, the fencing epoch and the time it was taken. The earlier one holds only `pid` and `at`, and is read as a legacy lock:
 * it names no host, so its pid is judged on this host, as before.
 *
 * A judgement is one of three things. `held`: the holder may be running, so the lock is kept. `reclaimable`: the holder is known to
 * be gone, and the lock may be removed under the reclaim protocol. `unknown`: the file cannot be judged, so nothing is removed and
 * the write is refused. There is no judgement by age: a lock is never reclaimed because it is old.
 */

/** Largest pid the kernel can allocate on the platforms this runs on; a larger number is not a pid, so it cannot be judged. */
export const MAX_PID = 0x7fffffff

export const LOCK_FORMAT = 2

export interface LockRecord {
  v: typeof LOCK_FORMAT
  /** Random, unique per acquisition: the identity the holder checks and releases by. */
  owner: string
  pid: number
  /** The process start time when the platform gives one, else null. */
  start: string | null
  /** The boot identifier when the platform gives one, else null. */
  boot: string | null
  host: string
  /** The fencing token this holder was granted. Strictly increasing across the grants that committed. */
  epoch: number
  /** When the lock was taken, as an ISO time. */
  at: string
  /** The sequence number of a move or restore this holder was appending, when it recorded one. */
  seq?: number
}

export interface LegacyLock {
  pid: number
  at: string
  seq: number | null
}

export type ParsedLock = { kind: "record"; record: LockRecord } | { kind: "legacy"; lock: LegacyLock } | { kind: "unknown" }

export type Liveness = "alive" | "dead" | "unknown"

/** The platform facts a judgement needs, passed in so the rules can be tested without the platform. */
export interface JudgementContext {
  host: string
  boot: string | null
  liveness(pid: number): Liveness
  startTimeOf(pid: number): string | null
}

export type Judgement =
  | { verdict: "held"; reason: "alive" | "other-host" | "start-unverified" }
  | { verdict: "reclaimable"; reason: "dead" | "legacy-dead" | "previous-boot" | "pid-reused" }
  | { verdict: "unknown"; reason: "unreadable" | "pid-unverifiable" }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isPid = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_PID

/** Parse a lock file's text. Anything that is not one of the two formats is `unknown`, and it is never read as a lock that can be reclaimed. */
export function parseLock(text: string): ParsedLock {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { kind: "unknown" }
  }
  if (!isObject(value)) return { kind: "unknown" }
  if (value.v === undefined) return parseLegacy(value)
  return value.v === LOCK_FORMAT ? parseRecord(value) : { kind: "unknown" }
}

function parseLegacy(value: Record<string, unknown>): ParsedLock {
  // The earlier format: an integer pid and a time. A pid that is not a positive integer is parsed, and judged unverifiable later.
  if (!Number.isInteger(value.pid) || typeof value.at !== "string") return { kind: "unknown" }
  const seq = value.seq === undefined ? null : value.seq
  if (seq !== null && !Number.isInteger(seq)) return { kind: "unknown" }
  return { kind: "legacy", lock: { pid: value.pid as number, at: value.at, seq: seq as number | null } }
}

function parseRecord(value: Record<string, unknown>): ParsedLock {
  const valid =
    typeof value.owner === "string" &&
    value.owner.length > 0 &&
    isPid(value.pid) &&
    (typeof value.start === "string" || value.start === null) &&
    (typeof value.boot === "string" || value.boot === null) &&
    typeof value.host === "string" &&
    Number.isInteger(value.epoch) &&
    (value.epoch as number) >= 0 &&
    typeof value.at === "string" &&
    (value.seq === undefined || Number.isInteger(value.seq))
  if (!valid) return { kind: "unknown" }
  return { kind: "record", record: value as unknown as LockRecord }
}

/** The text a holder writes for its record. */
export function serializeRecord(record: LockRecord): string {
  return JSON.stringify(record)
}

/** The sequence number a lock names for the move or restore its holder was appending, or null. */
export function seqOf(parsed: ParsedLock): number | null {
  if (parsed.kind === "record") return parsed.record.seq ?? null
  if (parsed.kind === "legacy") return parsed.lock.seq
  return null
}

/** The fencing epoch a lock was granted under: 0 for a legacy lock, which predates epochs. */
export function epochOf(parsed: ParsedLock): number {
  return parsed.kind === "record" ? parsed.record.epoch : 0
}

/** Judge a parsed lock. Pure: every fact about the platform comes through `ctx`. */
export function judgeLock(parsed: ParsedLock, ctx: JudgementContext): Judgement {
  if (parsed.kind === "unknown") return { verdict: "unknown", reason: "unreadable" }
  if (parsed.kind === "legacy") return judgeLegacy(parsed.lock, ctx)
  return judgeRecord(parsed.record, ctx)
}

function judgeLegacy(lock: LegacyLock, ctx: JudgementContext): Judgement {
  if (!isPid(lock.pid)) return { verdict: "unknown", reason: "pid-unverifiable" }
  const liveness = ctx.liveness(lock.pid)
  if (liveness === "dead") return { verdict: "reclaimable", reason: "legacy-dead" }
  if (liveness === "alive") return { verdict: "held", reason: "alive" }
  return { verdict: "unknown", reason: "pid-unverifiable" }
}

function judgeRecord(record: LockRecord, ctx: JudgementContext): Judgement {
  // A pid means something only on the host that wrote it: another host's lock is held, whatever its pid says here.
  if (record.host !== ctx.host) return { verdict: "held", reason: "other-host" }
  // A process cannot outlive a boot, so a lock from an earlier boot has no living holder.
  if (ctx.boot !== null && record.boot !== null && record.boot !== ctx.boot) {
    return { verdict: "reclaimable", reason: "previous-boot" }
  }
  const liveness = ctx.liveness(record.pid)
  if (liveness === "dead") return { verdict: "reclaimable", reason: "dead" }
  if (liveness === "unknown") return { verdict: "unknown", reason: "pid-unverifiable" }
  // The pid is alive. If the lock recorded its start time, a different start time means the number now belongs to another process.
  if (record.start === null) return { verdict: "held", reason: "alive" }
  const now = ctx.startTimeOf(record.pid)
  if (now === null) return { verdict: "held", reason: "start-unverified" }
  if (now !== record.start) return { verdict: "reclaimable", reason: "pid-reused" }
  return { verdict: "held", reason: "alive" }
}
