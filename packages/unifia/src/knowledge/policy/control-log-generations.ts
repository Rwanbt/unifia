/* SPDX-License-Identifier: MIT */
/**
 * Generation files of the Class C control log: their names, their line format,
 * the chain that links them, and the reader that checks the chain.
 *
 * ## Layout
 *
 * A trail is a folder of generations, oldest first:
 *
 *   control-log.jsonl.<k>   archived generations, k increasing (the legacy `.1` is k = 1)
 *   control-log.jsonl       the active generation, the newest
 *
 * Every generation of this format starts with a header line that records its
 * index, the sequence number of its first entry, and the hash the chain
 * continues from. Every entry carries `seq` (one more than the entry before it,
 * across generations) and `prev` (the SHA-256 of the entry line before it; the
 * genesis value before the first). A generation file therefore carries what it
 * needs to be checked on its own, and the chain links one file to the next.
 *
 * A generation written before this format has no header and no `seq`. It is
 * adopted as the oldest generation, and its status records that it cannot be
 * verified: `legacy: not verifiable before this format`.
 *
 * ## What a reader does with a damaged trail
 *
 * A line that does not parse (a torn tail, a stray `null`) is skipped and
 * reported as a notice, because a crash leaves such lines behind and they do
 * not break the chain. A gap in the sequence, a hash that does not match the
 * entry before it, a missing generation in the middle, a header that cannot be
 * read, or an entry that claims a sequence but is not a valid chained entry are
 * errors. A reader refuses to answer from a trail with an error: it does not
 * answer as if the hole were not there.
 *
 * Nothing in a finding carries an absolute path. A file name is reported; the
 * folder it sits in is not.
 */

import { createHash } from "node:crypto"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import type { EgressAuditEntry } from "./audit.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { readNoFollow } from "../mutation/durability.js"

/** The generation that is written to: the newest. */
export const ACTIVE_NAME = "control-log.jsonl"
/** A rotation's next active generation, written before it is committed. */
export const TEMP_NAME = `${ACTIVE_NAME}.rotating`
/** The one writer lock of a trail. */
export const LOCK_NAME = "control-log.lock"
/** The hash the first generation continues from. */
export const GENESIS = "0".repeat(64)
/** The status of a generation written before this format. */
export const LEGACY_STATUS = "legacy: not verifiable before this format"

const ARCHIVE_PATTERN = /^control-log\.jsonl\.(\d+)$/
const HEX64 = /^[0-9a-f]{64}$/
const SNAPSHOT_ATTEMPTS = 3
const READ_FAILURE = "the egress control log cannot be read"

export interface GenerationHeader {
  index: number
  firstSeq: number
  continues: string
}

export interface ChainHead {
  seq: number
  hash: string
}

/** A generation as it is on disk: its name and its text. */
export interface RawGeneration {
  name: string
  text: string
}

export interface RawTrail {
  /** Oldest first. The active generation is last, or the temporary one when a rotation stopped before its commit. */
  generations: RawGeneration[]
  /** The active generation is missing and a complete temporary one is waiting to be committed. */
  pendingCommit: boolean
  /** A temporary generation is left beside an active one: the rotation never sealed, so it is not part of the trail. */
  orphanTemp: boolean
}

/** One line, parsed as far as it can be. Shared by the writer and the reader, so both judge a line the same way. */
export interface ParsedLine {
  no: number
  raw: string
  header: GenerationHeader | null
  /** Parsed as a JSON object that names a generation, whether or not the header is valid. */
  claimsHeader: boolean
  entry: EgressAuditEntry | null
  seq: number | null
  prev: string | null
  /** Parsed as a JSON object that names a sequence number, whether or not the rest of the entry is valid. */
  claimsChain: boolean
}

export type GenerationFormat = "chained" | "legacy" | "damaged"

export interface ParsedGeneration {
  name: string
  /** The number in an archive's name; null for the active generation, whose index is in its header. */
  index: number | null
  format: GenerationFormat
  header: GenerationHeader | null
  /** The lines after the header; every line of a legacy generation. */
  body: ParsedLine[]
  bytes: number
}

export type ChainStatus = "empty" | "legacy" | "verified" | "broken"

export type FindingKind =
  | "missing_generation"
  | "header_invalid"
  | "sequence_gap"
  | "hash_mismatch"
  | "unchained_entry"
  | "malformed_entry"
  | "malformed_line"
  | "expired_generation"
  | "pending_commit"
  | "orphan_temporary"

export interface TrailFinding {
  kind: FindingKind
  severity: "error" | "notice"
  file: string
  line: number | null
  message: string
}

export interface GenerationReport {
  file: string
  index: number | null
  format: GenerationFormat
  status: string
  firstSeq: number | null
  lastSeq: number | null
  entries: number
  bytes: number
}

export interface TrailReport {
  ok: boolean
  chain: ChainStatus
  /** Generations read: the newest `retention` of them. */
  generationCount: number
  /** Generations older than the retention, still on disk until the next rotation removes them. */
  expiredCount: number
  firstSeq: number | null
  lastSeq: number | null
  entryCount: number
  bytes: number
  /** The hash of the last chained entry: an owner can record it and compare it later, since the verifier cannot know it alone. */
  head: string | null
  generations: GenerationReport[]
  findings: TrailFinding[]
  firstFinding: TrailFinding | null
}

export interface VerifiedTrail {
  report: TrailReport
  entries: EgressAuditEntry[]
}

export const archiveName = (index: number): string => `${ACTIVE_NAME}.${index}`

export function archiveIndexOf(name: string): number | null {
  const match = ARCHIVE_PATTERN.exec(name)
  return match === null ? null : Number(match[1])
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** The header line of a generation. */
export function headerLine(header: GenerationHeader): string {
  return JSON.stringify({
    generation: { index: header.index, firstSeq: header.firstSeq, continues: header.continues },
  })
}

/**
 * One entry as it is written. Serialised field by field rather than spread: a
 * field added to the entry type must be considered here before it reaches the
 * log, so a snippet or a token cannot arrive by accident.
 */
export function entryLine(entry: EgressAuditEntry, seq: number, prev: string): string {
  return JSON.stringify({
    seq,
    prev,
    hash: entry.hash,
    destination: entry.destination,
    decision: entry.decision,
    reason: entry.reason,
    guardVersion: entry.guardVersion,
    timestamp: entry.timestamp,
  })
}

const isSeq = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1

function objectOf(raw: string): Record<string, unknown> | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function headerOf(value: Record<string, unknown>): GenerationHeader | null {
  const generation = value.generation
  if (typeof generation !== "object" || generation === null || Array.isArray(generation)) return null
  const { index, firstSeq, continues } = generation as Record<string, unknown>
  if (!isSeq(index) || !isSeq(firstSeq) || typeof continues !== "string" || !HEX64.test(continues)) return null
  return { index, firstSeq, continues }
}

function entryOf(value: Record<string, unknown>): EgressAuditEntry | null {
  const { hash, destination, decision, reason, guardVersion, timestamp } = value
  if (
    typeof hash !== "string" ||
    typeof destination !== "string" ||
    (decision !== "allow" && decision !== "deny") ||
    typeof reason !== "string" ||
    typeof guardVersion !== "string" ||
    typeof timestamp !== "string"
  ) {
    return null
  }
  return { hash, destination, decision, reason, guardVersion, timestamp }
}

/** The chain fields of an entry: both absent (a legacy entry), both valid, or invalid (null). */
function chainOf(value: Record<string, unknown>): { seq: number | null; prev: string | null } | null {
  if (value.seq === undefined && value.prev === undefined) return { seq: null, prev: null }
  if (isSeq(value.seq) && typeof value.prev === "string" && HEX64.test(value.prev)) {
    return { seq: value.seq, prev: value.prev }
  }
  return null
}

/** Parse one line. Never throws: a line that is not what it should be comes back with nothing set. */
export function parseLine(raw: string, no = 1): ParsedLine {
  const base = { no, raw, header: null, claimsHeader: false, entry: null, seq: null, prev: null, claimsChain: false }
  const value = objectOf(raw)
  if (value === null) return base
  if (value.generation !== undefined) return { ...base, header: headerOf(value), claimsHeader: true }
  const chain = chainOf(value)
  const entry = entryOf(value)
  return {
    ...base,
    entry: chain === null ? null : entry,
    seq: chain?.seq ?? null,
    prev: chain?.prev ?? null,
    claimsChain: value.seq !== undefined,
  }
}

/** The non-blank lines of a text, parsed, with their line numbers. */
export function linesOf(text: string): ParsedLine[] {
  const out: ParsedLine[] = []
  text.split("\n").forEach((raw, i) => {
    if (raw.trim().length > 0) out.push(parseLine(raw, i + 1))
  })
  return out
}

/** The header of a generation's first line, if that line is one. */
export function headerOfText(firstLine: string): GenerationHeader | null {
  return parseLine(firstLine).header
}

/**
 * The hash a legacy generation hands to the next one: the last entry line that
 * parses, or the genesis value for a legacy generation with none.
 */
export function legacyHeadOf(body: readonly ParsedLine[]): string {
  for (let i = body.length - 1; i >= 0; i -= 1) {
    const line = body[i]
    if (line !== undefined && line.entry !== null && line.seq === null) return sha256(line.raw)
  }
  return GENESIS
}

export function legacyHeadOfText(text: string): string {
  return legacyHeadOf(linesOf(text))
}

/**
 * The last chained entry of a text, with the hash of its line. `partialFirst`
 * is set when the text starts in the middle of a line (a window of the file),
 * whose first segment is then not used.
 */
export function lastChainedOf(text: string, partialFirst: boolean): ChainHead | null {
  const segments = text.split("\n")
  const usable = partialFirst ? segments.slice(1) : segments
  for (let i = usable.length - 1; i >= 0; i -= 1) {
    const raw = usable[i] ?? ""
    if (raw.trim().length === 0) continue
    const line = parseLine(raw)
    if (line.entry !== null && line.seq !== null && line.prev !== null) return { seq: line.seq, hash: sha256(raw) }
  }
  return null
}

export function parseGeneration(file: RawGeneration): ParsedGeneration {
  const lines = linesOf(file.text)
  const first = lines[0]
  const header = first?.header ?? null
  const body = header === null ? lines : lines.slice(1)
  const damaged =
    header === null && (first?.claimsHeader === true || lines.some((line) => line.claimsChain || line.header !== null))
  const format: GenerationFormat = header !== null ? "chained" : damaged ? "damaged" : "legacy"
  return {
    name: file.name,
    index: archiveIndexOf(file.name),
    format,
    header,
    body,
    bytes: Buffer.byteLength(file.text, "utf8"),
  }
}

interface Summary {
  firstSeq: number | null
  lastSeq: number | null
  entries: number
}

/**
 * Walks the generations oldest first and checks the chain across them. The
 * state is the last sequence number and the hash the next entry must carry.
 */
class ChainWalk {
  private readonly findings: TrailFinding[] = []
  private readonly reports: GenerationReport[] = []
  private readonly entries: EgressAuditEntry[] = []
  private chain: { lastSeq: number; lastHash: string } | null = null
  private previousIndex: number | null = null
  private sawChained = false
  private firstSeq: number | null = null
  private head: string | null = null
  private bytes = 0

  expire(generation: ParsedGeneration): void {
    this.note(generation.name, "expired_generation", `beyond the retention; the next rotation removes it`)
  }

  walk(generation: ParsedGeneration): void {
    const errorsBefore = this.errorCount()
    this.bytes += generation.bytes
    this.checkIndex(generation)
    const summary = this.generation(generation)
    const broken = this.errorCount() > errorsBefore
    this.reports.push({
      file: generation.name,
      index: generation.index ?? generation.header?.index ?? null,
      format: generation.format,
      status: broken ? "broken" : generation.format === "legacy" ? LEGACY_STATUS : "verified",
      ...summary,
      bytes: generation.bytes,
    })
  }

  finish(expiredCount: number): VerifiedTrail {
    const errors = this.findings.filter((f) => f.severity === "error")
    const chain: ChainStatus =
      errors.length > 0
        ? "broken"
        : this.reports.some((r) => r.format === "chained")
          ? "verified"
          : this.reports.length > 0
            ? "legacy"
            : "empty"
    const report: TrailReport = {
      ok: errors.length === 0,
      chain,
      generationCount: this.reports.length,
      expiredCount,
      firstSeq: this.firstSeq,
      lastSeq: this.sawChained && this.chain !== null ? this.chain.lastSeq : null,
      entryCount: this.entries.length,
      bytes: this.bytes,
      head: this.head,
      generations: this.reports,
      findings: this.findings,
      firstFinding: errors[0] ?? null,
    }
    return { report, entries: this.entries }
  }

  private generation(generation: ParsedGeneration): { firstSeq: number | null; lastSeq: number | null; entries: number } {
    if (generation.format === "damaged") return this.damaged(generation)
    if (generation.format === "legacy") return this.legacy(generation)
    return this.chained(generation)
  }

  private checkIndex(generation: ParsedGeneration): void {
    const index = generation.index ?? generation.header?.index ?? null
    if (index === null) return
    if (this.previousIndex !== null) {
      if (index <= this.previousIndex) {
        this.error(generation.name, "header_invalid", "the generation is out of order with the one before it")
      } else if (index !== this.previousIndex + 1) {
        this.error(generation.name, "missing_generation", `generation ${this.previousIndex + 1} is missing`)
      }
    }
    this.previousIndex = index
  }

  /** A legacy generation is adopted without a check: its entries are read, and its last line anchors the chain after it. */
  private legacy(generation: ParsedGeneration): Summary {
    if (this.sawChained) this.error(generation.name, "header_invalid", "a generation without a header follows one with a header")
    const before = this.entries.length
    for (const line of generation.body) if (line.entry !== null) this.entries.push(line.entry)
    this.chain = { lastSeq: 0, lastHash: legacyHeadOf(generation.body) }
    return { firstSeq: null, lastSeq: null, entries: this.entries.length - before }
  }

  private damaged(generation: ParsedGeneration): Summary {
    this.error(generation.name, "header_invalid", "the generation has no readable header")
    this.chain = null
    return { firstSeq: null, lastSeq: null, entries: 0 }
  }

  private chained(generation: ParsedGeneration): Summary {
    const header = generation.header
    if (header === null) return this.damaged(generation)
    this.sawChained = true
    if (this.chain !== null) this.checkBoundary(generation.name, header, this.chain)
    if (this.firstSeq === null) this.firstSeq = header.firstSeq
    this.chain = { lastSeq: header.firstSeq - 1, lastHash: header.continues }
    const before = this.entries.length
    for (const line of generation.body) this.checkLine(generation.name, line)
    return { firstSeq: header.firstSeq, lastSeq: this.chain.lastSeq, entries: this.entries.length - before }
  }

  /** A generation must start where the one before it ended: the next sequence number, and the hash that one ended on. */
  private checkBoundary(file: string, header: GenerationHeader, chain: { lastSeq: number; lastHash: string }): void {
    if (header.firstSeq !== chain.lastSeq + 1) {
      this.error(file, "sequence_gap", `the generation starts at sequence ${header.firstSeq}, expected ${chain.lastSeq + 1}`)
    }
    if (header.continues !== chain.lastHash) {
      this.error(file, "hash_mismatch", "the generation does not continue from the entry before it")
    }
  }

  private checkLine(file: string, line: ParsedLine): void {
    // A header inside a generation, valid or not, means two generations were joined or a header was damaged: never skipped.
    if (line.header !== null || line.claimsHeader) {
      this.error(file, "header_invalid", "a generation header appears inside a generation", line.no)
      return
    }
    if (line.entry === null) {
      if (line.claimsChain) this.error(file, "malformed_entry", "an entry names a sequence but is not a valid chained entry", line.no)
      else this.note(file, "malformed_line", "a line that is not an entry is skipped", line.no)
      return
    }
    if (line.seq === null || line.prev === null) {
      this.error(file, "unchained_entry", "an entry carries no sequence number", line.no)
      return
    }
    const chain = this.chain
    if (chain === null) return
    if (line.seq !== chain.lastSeq + 1) {
      this.error(file, "sequence_gap", `expected sequence ${chain.lastSeq + 1}, found ${line.seq}`, line.no)
    }
    if (line.prev !== chain.lastHash) {
      this.error(file, "hash_mismatch", "an entry does not continue from the one before it", line.no)
    }
    this.chain = { lastSeq: line.seq, lastHash: sha256(line.raw) }
    this.head = this.chain.lastHash
    this.entries.push(line.entry)
  }

  private errorCount(): number {
    return this.findings.filter((f) => f.severity === "error").length
  }

  private error(file: string, kind: FindingKind, message: string, line: number | null = null): void {
    this.findings.push({ kind, severity: "error", file, line, message })
  }

  private note(file: string, kind: FindingKind, message: string, line: number | null = null): void {
    this.findings.push({ kind, severity: "notice", file, line, message })
  }
}

/** Check parsed generations, oldest first. Only the newest `retention` of them are read; the rest are expired notices. */
export function checkTrail(generations: readonly ParsedGeneration[], retention: number): VerifiedTrail {
  const expiredCount = Math.max(0, generations.length - retention)
  const walk = new ChainWalk()
  for (const generation of generations.slice(0, expiredCount)) walk.expire(generation)
  for (const generation of generations.slice(expiredCount)) walk.walk(generation)
  return walk.finish(expiredCount)
}

/** Check a raw trail, with the notices its state implies. */
export function verifyRawTrail(raw: RawTrail, retention: number): VerifiedTrail {
  const verified = checkTrail(raw.generations.map(parseGeneration), retention)
  const notes: TrailFinding[] = []
  if (raw.pendingCommit) {
    notes.push({ kind: "pending_commit", severity: "notice", file: TEMP_NAME, line: null, message: "a rotation stopped before its commit; the next write completes it" })
  }
  if (raw.orphanTemp) {
    notes.push({ kind: "orphan_temporary", severity: "notice", file: TEMP_NAME, line: null, message: "a temporary generation is left from a rotation that never sealed; the next write removes it" })
  }
  verified.report.findings.unshift(...notes)
  return verified
}

/**
 * The error a reader raises for a trail that does not verify. It is the vault's
 * own failure kind, so the server answers it like any other unavailable vault,
 * and it names no path.
 */
export function trailFailure(report: TrailReport): KnowledgeFailure {
  const first = report.firstFinding
  if (first === null) return KnowledgeFailure.sourceInconsistent("the egress control log does not verify")
  const gap = first.kind === "missing_generation" || first.kind === "sequence_gap"
  return KnowledgeFailure.sourceInconsistent(
    `the egress control log ${gap ? "is incomplete" : "does not verify"}: ${first.message}`,
  )
}

/** The trail's file names this module reads: archives, the active generation and a pending temporary. */
function listNames(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw KnowledgeFailure.sourceInconsistent(READ_FAILURE)
  }
  return names.filter((n) => n === ACTIVE_NAME || n === TEMP_NAME || archiveIndexOf(n) !== null).sort()
}

function readAll(dir: string, names: readonly string[]): Map<string, string> | null {
  const texts = new Map<string, string>()
  for (const name of names) {
    let read: ReturnType<typeof readNoFollow>
    try {
      read = readNoFollow(join(dir, name))
    } catch {
      throw KnowledgeFailure.sourceInconsistent(READ_FAILURE)
    }
    if (read.kind === "absent") return null
    if (read.kind !== "file") throw KnowledgeFailure.sourceInconsistent(READ_FAILURE)
    texts.set(name, read.text)
  }
  return texts
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i])
}

function assemble(names: readonly string[], texts: ReadonlyMap<string, string>): RawTrail {
  const archives = names
    .filter((n) => archiveIndexOf(n) !== null)
    .sort((a, b) => (archiveIndexOf(a) ?? 0) - (archiveIndexOf(b) ?? 0))
  const generations: RawGeneration[] = archives.map((name) => ({ name, text: texts.get(name) ?? "" }))
  const hasActive = names.includes(ACTIVE_NAME)
  const hasTemp = names.includes(TEMP_NAME)
  if (hasActive) generations.push({ name: ACTIVE_NAME, text: texts.get(ACTIVE_NAME) ?? "" })
  else if (hasTemp) generations.push({ name: TEMP_NAME, text: texts.get(TEMP_NAME) ?? "" })
  return { generations, pendingCommit: !hasActive && hasTemp, orphanTemp: hasActive && hasTemp }
}

/**
 * The generations of a trail, as one consistent snapshot. The folder is listed,
 * every file read, and the folder listed again: a rotation that ran in between
 * is read again, so a reader never mixes two sets. A folder that is missing is
 * an empty trail, and nothing is created to read one.
 */
export function readRawTrail(dir: string): RawTrail {
  for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
    const before = listNames(dir)
    const texts = readAll(dir, before)
    if (texts !== null && sameNames(before, listNames(dir))) return assemble(before, texts)
  }
  throw KnowledgeFailure.sourceInconsistent("the egress control log changed while it was being read")
}

/** Read a trail and check it: the one call a reader or the verifier makes. */
export function readVerifiedTrail(dir: string, retention: number): VerifiedTrail {
  return verifyRawTrail(readRawTrail(dir), retention)
}
