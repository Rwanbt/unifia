import { describe, it, expect } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { tmpdir } from "./fixture"
import { currentRun, fixtureDirSync, removeFixtureSync, type OwnerRecord } from "./run"

const CHILD = path.join(import.meta.dir, "run-child.ts")

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
