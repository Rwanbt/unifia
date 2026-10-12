import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

import { Process } from "../../src/util/process"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

const root = path.join(import.meta.dir, "../..")
const worker = path.join(import.meta.dir, "../fixture/plug-worker.ts")

// The child environment this test's workers run with.
//
// `Process.run` forwards `opts.env` to `Process.spawn`, which builds
// `{ ...process.env, ...opts.env }` (src/util/process.ts:66). A key therefore
// cannot be removed through `env`: a deleted key in `opts.env` is simply
// re-supplied by the parent env, and passing `""` leaves it *defined*. Only
// `env: null` reaches `launch` as `{}`.
//
// That matters because the flag module warns for any defined-but-unset setting
// (`src/flag/flag.ts:116-121` tests `!== undefined`) and writes to stderr:
//
//   [flag] ignoring OPENCODE_SERVER_PASSWORD: this setting is per-product ...
//
// `run()` asserts every worker wrote NOTHING to stderr, so on a machine carrying
// those variables — this dev box has all three — the assertion could not pass
// regardless of what the code under test did. Measured: 5/5 runs failing with
// them set, 5/5 passing with them cleared. A concurrency test must not inherit
// ambient credentials.
//
// `env: null` gives the worker a genuinely empty environment. It needs nothing
// from the parent: the worker's inputs all arrive as argv (see
// test/fixture/plug-worker.ts) and it writes only under `msg.dir`. What is lost
// is PATH, which Bun resolves before exec on Windows, and any real environment —
// which is the point.
const CHILD_ENV = null

type Msg = {
  dir: string
  target: string
  mod: string
  holdMs?: number
}

function run(msg: Msg) {
  return Process.run([process.execPath, worker, JSON.stringify(msg)], {
    cwd: root,
    nothrow: true,
    env: CHILD_ENV, // debug
  })
}

async function plugin(dir: string, kinds: Array<"server" | "tui">) {
  const p = path.join(dir, "plugin")
  const server = kinds.includes("server")
  const tui = kinds.includes("tui")
  const exports: Record<string, string> = {}
  if (server) exports["./server"] = "./server.js"
  if (tui) exports["./tui"] = "./tui.js"
  await fs.mkdir(p, { recursive: true })
  await Bun.write(
    path.join(p, "package.json"),
    JSON.stringify(
      {
        name: "acme",
        version: "1.0.0",
        ...(server ? { main: "./server.js" } : {}),
        ...(Object.keys(exports).length ? { exports } : {}),
      },
      null,
      2,
    ),
  )
  return p
}

async function read(file: string) {
  return Filesystem.readJson<{ plugin?: unknown[] }>(file)
}

function mods(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => `${prefix}-${i}@1.0.0`)
}

function expectPlugins(list: unknown[] | undefined, expectMods: string[]) {
  expect(Array.isArray(list)).toBe(true)
  const hit = (list ?? []).filter((item): item is string => typeof item === "string")
  expect(hit.length).toBe(expectMods.length)
  expect(new Set(hit)).toEqual(new Set(expectMods))
}

/**
 * Asserts every worker exited 0 and said nothing on stderr, and reports WHICH
 * worker failed and what it printed when it did not.
 *
 * `expect(codes).toEqual([0, 0, ...])` reports a bare list of integers, so a
 * failing run showed only which positions were non-zero (observed: 9 and 3) with
 * no indication of why. That is what made this look like a mysterious
 * concurrency defect rather than a diagnosable child failure.
 */
function expectWorkersSucceeded(mods: string[], out: Array<{ code: number; stdout: Buffer; stderr: Buffer }>) {
  const failed = out
    .map((x, i) => ({ i, code: x.code, mod: mods[i], stderr: x.stderr.toString() }))
    .filter((x) => x.code !== 0 || x.stderr.length > 0)
  if (failed.length === 0) return
  const detail = failed
    .map((x) => `#${x.i} (${x.mod}) exit=${x.code} stderr=${JSON.stringify(x.stderr.slice(0, 2000))}`)
    .join("\n  ")
  throw new Error(`${failed.length}/${out.length} worker(s) did not exit cleanly:\n  ${detail}`)
}

describe("plugin.install.concurrent", () => {
  test("serializes concurrent server config updates across processes", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const all = mods("mod-server", 12)

    const out = await Promise.all(
      all.map((mod) =>
        run({
          dir: tmp.path,
          target,
          mod,
          holdMs: 30,
        }),
      ),
    )

    expectWorkersSucceeded(all, out)

    const cfg = await read(path.join(tmp.path, ".unifia", "unifia.jsonc"))
    expectPlugins(cfg.plugin, all)
  }, 300_000)

  test("serializes concurrent server+tui config updates across processes", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server", "tui"])
    const all = mods("mod-both", 10)

    const out = await Promise.all(
      all.map((mod) =>
        run({
          dir: tmp.path,
          target,
          mod,
          holdMs: 30,
        }),
      ),
    )

    expectWorkersSucceeded(all, out)

    const server = await read(path.join(tmp.path, ".unifia", "unifia.jsonc"))
    const tui = await read(path.join(tmp.path, ".unifia", "tui.jsonc"))
    expectPlugins(server.plugin, all)
    expectPlugins(tui.plugin, all)
  }, 300_000)

  test("preserves updates when existing config uses .json", async () => {
    await using tmp = await tmpdir()
    const target = await plugin(tmp.path, ["server"])
    const cfg = path.join(tmp.path, ".unifia", "unifia.json")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    await Bun.write(cfg, JSON.stringify({ plugin: ["seed@1.0.0"] }, null, 2))

    const next = mods("mod-json", 8)
    const out = await Promise.all(
      next.map((mod) =>
        run({
          dir: tmp.path,
          target,
          mod,
          holdMs: 30,
        }),
      ),
    )

    expectWorkersSucceeded(next, out)

    const json = await read(cfg)
    expectPlugins(json.plugin, ["seed@1.0.0", ...next])
    expect(await Filesystem.exists(path.join(tmp.path, ".unifia", "unifia.jsonc"))).toBe(false)
  }, 300_000)
})
