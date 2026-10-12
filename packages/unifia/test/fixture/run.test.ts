import { describe, it, expect } from "bun:test"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { tmpdir } from "./fixture"
import {
  currentRun,
  fixtureDirSync,
  graceMsFromEnv,
  removeFixtureSync,
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

// A run directory with a hand-made owner record. Its boot id is null: pid and start time alone decide liveness.
function plantRun(root: string, input: { pid: number; createdAtMs: number; startTime?: number | null }): string {
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
    endedAt: null,
  }
  fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify(owner))
  return dir
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const newline = buffer.indexOf("\n")
    if (newline >= 0) return buffer.slice(0, newline)
    const { value, done } = await reader.read()
    if (done) return buffer
    buffer += decoder.decode(value, { stream: true })
  }
}

describe("run directory sweep: crash", () => {
  it("removes a SIGKILLed process's run directory only after the grace period", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    const child = Bun.spawn([process.execPath, CHILD, "crash", root], { stdout: "pipe", stderr: "pipe" })
    try {
      const report = JSON.parse(await firstLine(child.stdout)) as { run: string; createdAt: string; fixture: string }
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
    } finally {
      child.kill("SIGKILL")
      await child.exited
    }
  }, 20_000)
})

describe("run directory sweep: live owner", () => {
  it("never removes a run whose owner process is alive, however old", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    fs.mkdirSync(root, { recursive: true })
    const old = Date.now() - 10 * DAY

    const ownedByTest = plantRun(root, { pid: process.pid, createdAtMs: old })
    const live = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" })
    try {
      const ownedByChild = plantRun(root, { pid: live.pid, createdAtMs: old })
      const report = sweepAbandoned({ root, graceMs: HOUR })
      expect(report.removed).toEqual([])
      expect(fs.existsSync(ownedByTest)).toBe(true)
      expect(fs.existsSync(ownedByChild)).toBe(true)
      expect(report.kept).toContainEqual(expect.objectContaining({ name: path.basename(ownedByTest), reason: "owner-alive" }))
      expect(report.kept).toContainEqual(expect.objectContaining({ name: path.basename(ownedByChild), reason: "owner-alive" }))
    } finally {
      live.kill("SIGKILL")
      await live.exited
    }
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

describe("run directory", () => {
  it("holds the owner record of its process, and is removed with its residue when the run ends", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "unifia-tests")
    const child = Bun.spawn([process.execPath, CHILD, "end", root], { stdout: "pipe", stderr: "pipe" })
    const out = await new Response(child.stdout).text()
    await child.exited
    expect(child.exitCode).toBe(0)
    const { run, owner, fixture } = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as {
      run: string
      owner: OwnerRecord
      fixture: string
    }

    expect(owner.pid).toBe(child.pid)
    expect(owner.runId).toBe(path.basename(run))
    expect(owner.endedAt).toBeNull()
    expect(path.dirname(fixture)).toBe(run)
    expect(path.dirname(run)).toBe(fs.realpathSync.native(root))
    // The run ended at exit: its directory, and the fixture left in it, are gone.
    expect(fs.existsSync(run)).toBe(false)
  }, 20_000)

  it("is one directory per process, named with a random id", () => {
    const run = currentRun()
    expect(currentRun().path).toBe(run.path)
    expect(path.basename(run.path)).toMatch(/^run-[0-9a-f]{16}$/)
    expect(run.owner.pid).toBe(process.pid)
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
