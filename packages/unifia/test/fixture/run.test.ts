import { describe, it, expect } from "bun:test"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { tmpdir } from "./fixture"
import {
  ChildDidNotExit,
  currentRun,
  fixtureDirSync,
  graceMsFromEnv,
  pidAlive,
  reapChildren,
  removeFixtureSync,
  retainMsFromEnv,
  sweepAbandoned,
  type OwnerRecord,
} from "./run"

const CHILD = path.join(import.meta.dir, "run-child.ts")
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Windows creates directory links as junctions, which need no privilege.
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir"

async function deadPid(): Promise<number> {
  const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
  await child.exited
  return child.pid
}

// Writes a run directory with a hand-made owner record. The boot id is left null so the
// test controls liveness only through pid and start time. endedAtMs marks a run that ended.
function plantRun(
  root: string,
  input: { pid: number; createdAtMs: number; startTime?: number | null; endedAtMs?: number },
): string {
  const runId = `run-${crypto.randomUUID()}`
  const dir = path.join(root, runId)
  fs.mkdirSync(dir, { recursive: true })
  const owner: OwnerRecord = {
    format: 1,
    runId,
    pid: input.pid,
    host: os.hostname(),
    bootId: null,
    startTime: input.startTime ?? null,
    createdAt: new Date(input.createdAtMs).toISOString(),
    endedAt: input.endedAtMs === undefined ? null : new Date(input.endedAtMs).toISOString(),
  }
  fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify(owner))
  return dir
}

function readOwner(dir: string): OwnerRecord {
  return JSON.parse(fs.readFileSync(path.join(dir, "owner.json"), "utf8")) as OwnerRecord
}

function piped(stream: ReadableStream<Uint8Array> | null | undefined): ReadableStream<Uint8Array> {
  if (!stream) throw new Error("child stdout was not piped")
  return stream
}

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      yield buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
    }
  }
  if (buffer) yield buffer
}

function fakeChild(pid: number, exitsOn: NodeJS.Signals | null) {
  const signals: string[] = []
  let finish!: (code: number) => void
  const exited = new Promise<number>((resolve) => (finish = resolve))
  const handle = {
    pid,
    exited,
    kill(signal?: NodeJS.Signals | number) {
      const name = String(signal ?? "SIGTERM")
      signals.push(name)
      if (name === exitsOn) finish(0)
    },
  }
  return { handle, signals }
}

describe("run directory sweep: crash", () => {
  it("removes a SIGKILLed process's run directory only after the grace period", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    const child = tmp.spawn([process.execPath, CHILD, "crash", root], { stdout: "pipe", stderr: "pipe" })
    const first = await lines(piped(child.stdout)).next()
    const report = JSON.parse(first.value ?? "{}") as { run: string; createdAt: string; fixture: string }
    expect(fs.existsSync(report.fixture)).toBe(true)

    child.kill("SIGKILL")
    await child.exited
    expect(fs.existsSync(report.run)).toBe(true)

    const grace = 3000
    const early = sweepAbandoned({ root, graceMs: grace })
    expect(early.removed).toEqual([])
    expect(early.kept).toContainEqual(expect.objectContaining({ name: path.basename(report.run), reason: "within-grace" }))
    expect(fs.existsSync(report.run)).toBe(true)

    await Bun.sleep(Math.max(0, Date.parse(report.createdAt) + grace + 50 - Date.now()))
    const late = sweepAbandoned({ root, graceMs: grace })
    expect(late.removed).toEqual([path.basename(report.run)])
    expect(fs.existsSync(report.run)).toBe(false)
  }, 20_000)
})

describe("run directory sweep: live owner", () => {
  it("never removes a run whose owner process is alive, however old", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    fs.mkdirSync(root, { recursive: true })
    const old = Date.now() - 10 * DAY

    const ownedByTest = plantRun(root, { pid: process.pid, createdAtMs: old })
    const live = tmp.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const ownedByChild = plantRun(root, { pid: live.pid, createdAtMs: old })

    const report = sweepAbandoned({ root, graceMs: HOUR })
    expect(report.removed).toEqual([])
    expect(fs.existsSync(ownedByTest)).toBe(true)
    expect(fs.existsSync(ownedByChild)).toBe(true)
    expect(report.kept).toContainEqual(expect.objectContaining({ name: path.basename(ownedByTest), reason: "owner-alive" }))
    expect(report.kept).toContainEqual(expect.objectContaining({ name: path.basename(ownedByChild), reason: "owner-alive" }))
    live.kill("SIGKILL")
    await live.exited
  })

  it.if(process.platform === "linux")("treats a run whose pid now belongs to a different process as orphaned", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    fs.mkdirSync(root, { recursive: true })
    // The recorded start time (1 tick) cannot match the live test process, so the pid was reused.
    const reused = plantRun(root, { pid: process.pid, createdAtMs: Date.now() - DAY, startTime: 1 })
    const report = sweepAbandoned({ root, graceMs: HOUR })
    expect(report.removed).toEqual([path.basename(reused)])
    expect(fs.existsSync(reused)).toBe(false)
  })

  it("never removes a run whose owner is alive, even long after it ended", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    fs.mkdirSync(root, { recursive: true })
    const long = Date.now() - 10 * DAY
    const ended = plantRun(root, { pid: process.pid, createdAtMs: long, endedAtMs: long })
    const report = sweepAbandoned({ root, graceMs: HOUR, retainMs: HOUR })
    expect(report.removed).toEqual([])
    expect(fs.existsSync(ended)).toBe(true)
    expect(report.kept).toContainEqual(expect.objectContaining({ name: path.basename(ended), reason: "owner-alive" }))
  })
})

describe("run directory sweep: symbolic links", () => {
  it("does not follow a link inside a run directory, and does not remove a linked run", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    const outside = path.join(tmp.path, "outside")
    fs.mkdirSync(root, { recursive: true })
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, "keep.txt"), "keep")
    const old = Date.now() - DAY
    const pid = await deadPid()

    const dead = plantRun(root, { pid, createdAtMs: old })
    fs.symlinkSync(outside, path.join(dead, "escape"), LINK_TYPE)

    const targetRun = plantRun(outside, { pid, createdAtMs: old })
    const linkedRun = path.join(root, "run-linked")
    fs.symlinkSync(targetRun, linkedRun, LINK_TYPE)

    const report = sweepAbandoned({ root, graceMs: 0 })
    expect(report.removed).toEqual([path.basename(dead)])
    expect(fs.existsSync(dead)).toBe(false)
    expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("keep")
    expect(fs.existsSync(targetRun)).toBe(true)
    expect(report.kept).toContainEqual(expect.objectContaining({ name: "run-linked", reason: "symlink" }))
    expect(fs.lstatSync(linkedRun).isSymbolicLink()).toBe(true)
  })
})

describe("run directory sweep: missing or unreadable owner record", () => {
  it("leaves a run directory with no owner record alone and reports it", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    const bare = path.join(root, `run-${crypto.randomUUID()}`)
    fs.mkdirSync(path.join(bare, "unifia-test-x"), { recursive: true })
    const report = sweepAbandoned({ root, graceMs: 0 })
    expect(fs.existsSync(bare)).toBe(true)
    expect(report.kept).toContainEqual(expect.objectContaining({ name: path.basename(bare), reason: "no-owner-record" }))
  })

  it("leaves a run directory with an unparseable owner record alone and reports it", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    const broken = path.join(root, `run-${crypto.randomUUID()}`)
    fs.mkdirSync(broken, { recursive: true })
    fs.writeFileSync(path.join(broken, "owner.json"), "{not json")
    const report = sweepAbandoned({ root, graceMs: 0 })
    expect(fs.existsSync(broken)).toBe(true)
    expect(report.kept).toContainEqual(expect.objectContaining({ name: path.basename(broken), reason: "owner-unreadable" }))
  })
})

describe("run directory sweep: grace period", () => {
  it("removes an orphaned run only once it is at least one grace period old", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    fs.mkdirSync(root, { recursive: true })
    const created = Date.now()
    const dir = plantRun(root, { pid: await deadPid(), createdAtMs: created })
    const grace = 10_000
    expect(sweepAbandoned({ root, graceMs: grace, now: created + grace - 1 }).removed).toEqual([])
    expect(fs.existsSync(dir)).toBe(true)
    expect(sweepAbandoned({ root, graceMs: grace, now: created + grace }).removed).toEqual([path.basename(dir)])
  })

  it("reads the grace period from UNIFIA_TEST_SWEEP_GRACE_MS, with a one-hour default", () => {
    expect(graceMsFromEnv({})).toBe(HOUR)
    expect(graceMsFromEnv({ UNIFIA_TEST_SWEEP_GRACE_MS: "1234" })).toBe(1234)
    expect(graceMsFromEnv({ UNIFIA_TEST_SWEEP_GRACE_MS: "nope" })).toBe(HOUR)
  })
})

describe("run directory sweep: retention", () => {
  it("keeps a run directory left at exit, and removes it only once the retention period has passed", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    const retain = 10_000
    const child = tmp.spawn([process.execPath, CHILD, "retain", root], { stdout: "pipe", stderr: "pipe" })
    const out = await new Response(child.stdout).text()
    await child.exited
    expect(child.exitCode).toBe(0)
    const { run } = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as { run: string }
    const name = path.basename(run)

    // The run ended at exit: its directory is stamped, its owner is gone, and it is kept.
    expect(fs.existsSync(run)).toBe(true)
    const owner = readOwner(run)
    expect(owner.endedAt).not.toBeNull()
    expect(pidAlive(owner.pid)).toBe(false)
    const ended = Date.parse(owner.endedAt ?? "")
    expect(sweepAbandoned({ root, graceMs: 0, retainMs: retain }).removed).toEqual([])
    expect(fs.existsSync(run)).toBe(true)

    // Not before: right after the run ended, and one millisecond short of the retention period.
    expect(sweepAbandoned({ root, graceMs: 0, retainMs: retain, now: ended }).kept).toContainEqual(
      expect.objectContaining({ name, reason: "within-retention" }),
    )
    expect(sweepAbandoned({ root, graceMs: 0, retainMs: retain, now: ended + retain - 1 }).removed).toEqual([])
    expect(fs.existsSync(run)).toBe(true)

    // Removed once the retention period has passed.
    expect(sweepAbandoned({ root, graceMs: 0, retainMs: retain, now: ended + retain }).removed).toEqual([name])
    expect(fs.existsSync(run)).toBe(false)
  }, 20_000)

  it("reads the retention period from UNIFIA_TEST_RETAIN_SECONDS, with a one-hour default", () => {
    expect(retainMsFromEnv({})).toBe(HOUR)
    expect(retainMsFromEnv({ UNIFIA_TEST_RETAIN_SECONDS: "90" })).toBe(90_000)
    expect(retainMsFromEnv({ UNIFIA_TEST_RETAIN_SECONDS: "nope" })).toBe(HOUR)
  })
})

describe("run directory sweep: parallel processes", () => {
  it("lets two processes sweep one root without removing each other's live run", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    fs.mkdirSync(root, { recursive: true })
    const dead = plantRun(root, { pid: await deadPid(), createdAtMs: Date.now() - DAY })

    const spawnSweeper = () =>
      tmp.spawn([process.execPath, CHILD, "sweep", root, "1500"], { stdout: "pipe", stderr: "pipe" })
    const a = spawnSweeper()
    const b = spawnSweeper()
    const [outA, outB] = await Promise.all([
      new Response(a.stdout).text(),
      new Response(b.stdout).text(),
      a.exited,
      b.exited,
    ])
    expect(a.exitCode).toBe(0)
    expect(b.exitCode).toBe(0)
    const reportA = JSON.parse(outA.trim().split("\n").at(-1) ?? "{}") as { done?: boolean; overlap: number }
    const reportB = JSON.parse(outB.trim().split("\n").at(-1) ?? "{}") as { done?: boolean; overlap: number }
    expect(reportA.done).toBe(true)
    expect(reportB.done).toBe(true)
    // Each child must have seen the other's live run during its sweeps, or the test proves nothing.
    expect(reportA.overlap).toBeGreaterThan(0)
    expect(reportB.overlap).toBeGreaterThan(0)
    expect(fs.existsSync(dead)).toBe(false)
    // Each child ended its own run at exit, so both directories are kept, stamped, with dead owners.
    // They are removed after the retention period (see the retention tests), not by the exit.
    const left = fs.readdirSync(root).filter((name) => name.startsWith("run-"))
    expect(left).toHaveLength(2)
    for (const name of left) {
      const owner = readOwner(path.join(root, name))
      expect(owner.endedAt).not.toBeNull()
      expect(pidAlive(owner.pid)).toBe(false)
    }
  }, 30_000)
})

describe("child process reaping", () => {
  it("reaps a child that exits on SIGTERM, and reports a child that never exits", async () => {
    const quits = fakeChild(1, "SIGTERM")
    await reapChildren([quits.handle], { termMs: 200, killMs: 200 })
    expect(quits.signals).toEqual(["SIGTERM"])

    const stuck = fakeChild(2, null)
    const error = await reapChildren([stuck.handle], { termMs: 20, killMs: 20 }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(ChildDidNotExit)
    expect((error as ChildDidNotExit).pids).toEqual([2])
    expect(stuck.signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  it("escalates to SIGKILL for a child that ignores SIGTERM", async () => {
    const stubborn = fakeChild(3, "SIGKILL")
    await reapChildren([stubborn.handle], { termMs: 20, killMs: 200 })
    expect(stubborn.signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  it("terminates a child started through a fixture before the fixture is removed", async () => {
    let pid = 0
    {
      await using tmp = await tmpdir()
      const child = tmp.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
        stdout: "ignore",
        stderr: "ignore",
      })
      pid = child.pid
      expect(pidAlive(pid)).toBe(true)
    }
    expect(pidAlive(pid)).toBe(false)
  })
})

describe("fixture placement and disposal", () => {
  it("places a tmpdir fixture inside the process run directory and removes it on dispose", async () => {
    const run = currentRun()
    let dir = ""
    {
      await using tmp = await tmpdir()
      dir = tmp.path
      expect(path.dirname(tmp.path)).toBe(run.path)
      expect(fs.existsSync(tmp.path)).toBe(true)
    }
    expect(fs.existsSync(dir)).toBe(false)
  })

  it("keeps a fixture for inspection when UNIFIA_TEST_KEEP=1", () => {
    const dir = fixtureDirSync("keep-")
    const prior = process.env["UNIFIA_TEST_KEEP"]
    process.env["UNIFIA_TEST_KEEP"] = "1"
    try {
      removeFixtureSync(dir)
      expect(fs.existsSync(dir)).toBe(true)
    } finally {
      if (prior === undefined) delete process.env["UNIFIA_TEST_KEEP"]
      else process.env["UNIFIA_TEST_KEEP"] = prior
    }
    removeFixtureSync(dir)
    expect(fs.existsSync(dir)).toBe(false)
  })
})
