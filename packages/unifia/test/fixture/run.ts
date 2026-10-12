// Run-scoped test fixtures.
//
// Each test process owns one run directory, <tmp>/unifia-tests/run-<id>/, holding an owner record
// (owner.json). Fixtures are created inside it, so every fixture has an owner. When the run ends, the
// directory is removed. The rules are in test/AGENTS.md ("Run directories").
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

export const RUN_ROOT_NAME = "unifia-tests"
export const RUN_FORMAT = 1
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

export function defaultRoot(): string {
  return path.join(os.tmpdir(), RUN_ROOT_NAME)
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

// Called once from the test preload: creates this process's run directory.
export function initTestRun(options: { root?: string } = {}): { run: Run } {
  const state = runState()
  if (!state.run) state.run = createRun({ root: options.root ?? defaultRoot() })
  return { run: state.run }
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
