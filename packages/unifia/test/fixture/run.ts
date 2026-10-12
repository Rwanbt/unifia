// Run-scoped test fixtures.
//
// Each test process owns one run directory, <tmp>/unifia-tests/run-<id>/, holding an owner record
// (owner.json). Fixtures are created inside it, so every fixture has an owner. When the run ends, the
// directory is removed. A run that was killed never ends: a sweep at test start removes its directory once its
// owner is gone and the grace period has passed. The rules are in test/AGENTS.md ("Run directories").
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

export const RUN_ROOT_NAME = "unifia-tests"
export const RUN_FORMAT = 1
export const DEFAULT_GRACE_MS = 60 * 60 * 1000
const RUN_PREFIX = "run-"
const OWNER_FILE = "owner.json"
const STATE_KEY = "__unifiaTestRun"

export type OwnerRecord = {
  format: number
  runId: string
  pid: number
  host: string
  bootId: string | null
  startTime: number | null
  createdAt: string
  // The time the run ended, for a run directory that is kept after its end. Null for a live run, and for
  // every run here: an ended run's directory is removed.
  endedAt: string | null
}

export type Run = { root: string; path: string; owner: OwnerRecord }

export type SweepReason =
  | "not-a-run"
  | "symlink"
  | "not-a-directory"
  | "outside-root"
  | "no-owner-record"
  | "owner-unreadable"
  | "owner-alive"
  | "within-grace"
  | "remove-failed"

export type SweepReport = {
  removed: string[]
  kept: { name: string; reason: SweepReason; detail?: string }[]
}

export function defaultRoot(): string {
  return path.join(os.tmpdir(), RUN_ROOT_NAME)
}

export function graceMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["UNIFIA_TEST_SWEEP_GRACE_MS"]
  if (raw === undefined || raw.trim() === "") return DEFAULT_GRACE_MS
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_GRACE_MS
}

// UNIFIA_TEST_KEEP=1 keeps every fixture for inspection, and the test is not allowed to remove it.
export function keepFixtures(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["UNIFIA_TEST_KEEP"] === "1"
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT"
}

// Linux only. Elsewhere the boot id and start time are null and the owner check uses the pid alone.
function bootId(): string | null {
  try {
    const id = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
    return id === "" ? null : id
  } catch {
    return null
  }
}

// Field 22 of /proc/<pid>/stat is the start time in clock ticks since boot. The command name in
// field 2 may contain spaces and parentheses, so fields are counted after the last ")".
export function startTimeOf(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8")
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    const value = Number(fields[19])
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH is the only answer that means "gone". EPERM means it exists under another user.
    return (err as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

// An owner is gone when its process is dead, when the machine has rebooted since the record was
// written, or when the pid now belongs to a process that started later (pid reuse).
export function ownerIsGone(owner: OwnerRecord, currentBootId: string | null): boolean {
  if (owner.bootId !== null && currentBootId !== null && owner.bootId !== currentBootId) return true
  if (!pidAlive(owner.pid)) return true
  if (owner.startTime !== null) {
    const now = startTimeOf(owner.pid)
    if (now !== null && now !== owner.startTime) return true
  }
  return false
}

function isOwnerRecord(value: unknown, runId: string): value is OwnerRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const { format, pid, host, bootId: boot, startTime, createdAt, endedAt } = record
  return (
    format === RUN_FORMAT &&
    record["runId"] === runId &&
    typeof pid === "number" &&
    Number.isInteger(pid) &&
    pid > 0 &&
    typeof host === "string" &&
    (boot === null || typeof boot === "string") &&
    (startTime === null || typeof startTime === "number") &&
    typeof createdAt === "string" &&
    Number.isFinite(Date.parse(createdAt)) &&
    (endedAt === null || (typeof endedAt === "string" && Number.isFinite(Date.parse(endedAt))))
  )
}

type OwnerRead = { kind: "missing" } | { kind: "invalid"; detail: string } | { kind: "ok"; owner: OwnerRecord }

export function readOwner(runDir: string, runId: string): OwnerRead {
  let text: string
  try {
    text = fs.readFileSync(path.join(runDir, OWNER_FILE), "utf8")
  } catch (err) {
    return isMissing(err) ? { kind: "missing" } : { kind: "invalid", detail: "unreadable" }
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { kind: "invalid", detail: "not JSON" }
  }
  if (!isOwnerRecord(value, runId)) return { kind: "invalid", detail: "unexpected shape or format" }
  return { kind: "ok", owner: value }
}

function writeOwner(runDir: string, owner: OwnerRecord): void {
  const target = path.join(runDir, OWNER_FILE)
  const staging = `${target}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(staging, `${JSON.stringify(owner, null, 2)}\n`)
  fs.renameSync(staging, target)
}

// Creates a new run directory with its owner record. The name is a fresh random id, so two processes
// do not share one.
export function createRun(input: { root?: string } = {}): Run {
  const requested = input.root ?? defaultRoot()
  fs.mkdirSync(requested, { recursive: true })
  // The native resolver, the one tmpdir() uses. The JavaScript one keeps a Windows short name (RUNNER~1) that
  // the native one expands, so the run path and a fixture's path would differ on Windows.
  const root = fs.realpathSync.native(requested)
  // Short on purpose: fixture paths sit under this name, and Windows limits paths to 260 characters.
  // mkdirSync below is not recursive, so a collision fails loudly rather than sharing a directory.
  const runId = `${RUN_PREFIX}${crypto.randomBytes(8).toString("hex")}`
  const runDir = path.join(root, runId)
  fs.mkdirSync(runDir)
  const owner: OwnerRecord = {
    format: RUN_FORMAT,
    runId,
    pid: process.pid,
    host: os.hostname(),
    bootId: bootId(),
    startTime: startTimeOf(process.pid),
    createdAt: new Date().toISOString(),
    endedAt: null,
  }
  writeOwner(runDir, owner)
  runState().owned.set(runDir, owner)
  installHandlers()
  return { root, path: runDir, owner }
}

const pauseCell = new Int32Array(new SharedArrayBuffer(4))
const RETRYABLE = new Set(["EBUSY", "EPERM", "ENOTEMPTY"])

function withRetry(op: () => void): void {
  for (let attempt = 1; ; attempt++) {
    try {
      op()
      return
    } catch (err) {
      if (isMissing(err)) return
      const code = (err as NodeJS.ErrnoException).code ?? ""
      if (attempt >= 6 || !RETRYABLE.has(code)) throw err
      Atomics.wait(pauseCell, 0, 0, 100)
    }
  }
}

// Removes a tree without following links. A symbolic link, or a Windows directory junction, is
// removed as a link and never entered, so whatever it points at survives.
export function removeTree(target: string): void {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(target)
  } catch (err) {
    if (isMissing(err)) return
    throw err
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) removeTree(path.join(target, name))
    withRetry(() => fs.rmdirSync(target))
    return
  }
  if (stat.isSymbolicLink()) {
    withRetry(() => {
      try {
        fs.unlinkSync(target)
      } catch (err) {
        // A Windows directory link needs rmdir; unlink refuses it with EPERM or EISDIR.
        const code = (err as NodeJS.ErrnoException).code
        if (code === "EPERM" || code === "EISDIR") fs.rmdirSync(target)
        else throw err
      }
    })
    return
  }
  withRetry(() => fs.unlinkSync(target))
}

function sameEntry(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

// Removes run directories whose owner is gone. A directory is removed only when every one of these
// holds: its name is a run name; it is a real directory directly under the real root (not a link); its
// owner record exists and parses; its owner process is gone; and it is at least graceMs old.
export function sweepAbandoned(input: { root: string; graceMs: number; now?: number }): SweepReport {
  const report: SweepReport = { removed: [], kept: [] }
  let names: string[]
  try {
    names = fs.readdirSync(input.root)
  } catch (err) {
    if (isMissing(err)) return report
    throw err
  }
  const root = fs.realpathSync(input.root)
  const now = input.now ?? Date.now()
  const currentBoot = bootId()
  for (const name of names) {
    const keep = (reason: SweepReason, detail?: string) => report.kept.push({ name, reason, detail })
    if (!name.startsWith(RUN_PREFIX)) {
      keep("not-a-run")
      continue
    }
    const entry = path.join(root, name)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(entry)
    } catch (err) {
      if (isMissing(err)) continue
      throw err
    }
    if (stat.isSymbolicLink()) {
      keep("symlink")
      continue
    }
    if (!stat.isDirectory()) {
      keep("not-a-directory")
      continue
    }
    if (!sameEntry(path.dirname(fs.realpathSync(entry)), root)) {
      keep("outside-root")
      continue
    }
    const read = readOwner(entry, name)
    if (read.kind === "missing") {
      keep("no-owner-record")
      continue
    }
    if (read.kind === "invalid") {
      keep("owner-unreadable", read.detail)
      continue
    }
    if (!ownerIsGone(read.owner, currentBoot)) {
      keep("owner-alive")
      continue
    }
    if (now - Date.parse(read.owner.createdAt) < input.graceMs) {
      keep("within-grace")
      continue
    }
    try {
      removeTree(entry)
      report.removed.push(name)
    } catch (err) {
      keep("remove-failed", String(err))
    }
  }
  return report
}

type RunState = { run?: Run; handlers: boolean; owned: Map<string, OwnerRecord> }

function runState(): RunState {
  const host = globalThis as unknown as Record<string, RunState | undefined>
  let state = host[STATE_KEY]
  if (!state) {
    state = { handlers: false, owned: new Map() }
    host[STATE_KEY] = state
  }
  return state
}

// Ends this process's runs: each run directory is removed with whatever its fixtures left behind.
// Idempotent. The test preload calls it from afterAll, because bun test does not emit process "exit"
// events. The exit and signal handlers cover plain scripts and interrupted runs. With UNIFIA_TEST_KEEP=1
// the directories are kept for inspection.
export function releaseRuns(): void {
  const state = runState()
  if (keepFixtures()) return
  for (const dir of state.owned.keys()) {
    try {
      removeTree(dir)
    } catch {
      // the directory is busy or gone: it stays until it is removed by hand
    }
  }
  state.owned.clear()
}

function installHandlers(): void {
  const state = runState()
  if (state.handlers) return
  state.handlers = true
  process.on("exit", releaseRuns)
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      releaseRuns()
      process.exit(128 + os.constants.signals[signal])
    })
  }
}

export function currentRun(): Run {
  const state = runState()
  if (!state.run) state.run = createRun()
  return state.run
}

// Called once from the test preload: sweeps abandoned run directories, then creates this
// process's run directory.
export function initTestRun(options: { root?: string; graceMs?: number } = {}): { run: Run; sweep: SweepReport } {
  const root = options.root ?? defaultRoot()
  const sweep = sweepAbandoned({ root, graceMs: options.graceMs ?? graceMsFromEnv() })
  const state = runState()
  if (!state.run) state.run = createRun({ root })
  return { run: state.run, sweep }
}

// One line for the test log when the sweep removed something or left an entry it could not vouch for.
export function sweepSummary(report: SweepReport): string | undefined {
  const unowned = report.kept.filter((entry) =>
    ["no-owner-record", "owner-unreadable", "remove-failed", "symlink"].includes(entry.reason),
  )
  const parts: string[] = []
  if (report.removed.length > 0) parts.push(`removed ${report.removed.length} abandoned run director${report.removed.length === 1 ? "y" : "ies"}`)
  if (unowned.length > 0) {
    parts.push(`left ${unowned.length} unowned entr${unowned.length === 1 ? "y" : "ies"}: ${unowned.map((e) => `${e.name} (${e.reason})`).join(", ")}`)
  }
  return parts.length > 0 ? `[unifia-test] ${parts.join("; ")}` : undefined
}

export function fixtureDirSync(prefix = "unifia-test-"): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(currentRun().path, prefix)))
}

export function removeFixtureSync(dir: string): void {
  if (keepFixtures()) return
  removeTree(dir)
}

export async function removeFixture(dir: string): Promise<void> {
  if (keepFixtures()) return
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
