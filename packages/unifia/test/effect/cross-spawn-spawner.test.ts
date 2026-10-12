import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Exit, Fiber, Layer, Stream } from "effect"
import type * as PlatformError from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const live = CrossSpawnSpawner.defaultLayer
const fx = testEffect(live)

function js(code: string, opts?: ChildProcess.CommandOptions) {
  return ChildProcess.make("node", ["-e", code], opts)
}

function decodeByteStream(stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) {
  return Stream.runCollect(stream).pipe(
    Effect.map((chunks) => {
      const total = chunks.reduce((acc, x) => acc + x.length, 0)
      const out = new Uint8Array(total)
      let off = 0
      for (const chunk of chunks) {
        out.set(chunk, off)
        off += chunk.length
      }
      return new TextDecoder("utf-8").decode(out).trim()
    }),
  )
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function gone(pid: number, timeout = 5_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (!alive(pid)) return true
    await Bun.sleep(50)
  }
  return !alive(pid)
}

describe("cross-spawn spawner", () => {
  describe("basic spawning", () => {
    fx.effect(
      "captures stdout",
      Effect.gen(function* () {
        const out = yield* ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(ChildProcess.make(process.execPath, ["-e", 'process.stdout.write("ok")'])),
        )
        expect(out).toBe("ok")
      }),
    )

    fx.effect(
      "captures multiple lines",
      Effect.gen(function* () {
        const handle = yield* js('console.log("line1"); console.log("line2"); console.log("line3")')
        const out = yield* decodeByteStream(handle.stdout)
        expect(out).toBe("line1\nline2\nline3")
      }),
    )

    fx.effect(
      "returns exit code",
      Effect.gen(function* () {
        const handle = yield* js("process.exit(0)")
        const code = yield* handle.exitCode
        expect(code).toBe(ChildProcessSpawner.ExitCode(0))
      }),
    )

    fx.effect(
      "returns non-zero exit code",
      Effect.gen(function* () {
        const handle = yield* js("process.exit(42)")
        const code = yield* handle.exitCode
        expect(code).toBe(ChildProcessSpawner.ExitCode(42))
      }),
    )
  })

  describe("cwd option", () => {
    fx.effect(
      "uses cwd when spawning commands",
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const out = yield* ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(
            ChildProcess.make(process.execPath, ["-e", "process.stdout.write(process.cwd())"], { cwd: tmp.path }),
          ),
        )
        expect(out).toBe(tmp.path)
      }),
    )

    fx.effect(
      "fails for invalid cwd",
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          ChildProcess.make("echo", ["test"], { cwd: "/nonexistent/directory/path" }).asEffect(),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )
  })

  describe("env option", () => {
    fx.effect(
      "passes environment variables with extendEnv",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write(process.env.TEST_VAR ?? "")', {
          env: { TEST_VAR: "test_value" },
          extendEnv: true,
        })
        const out = yield* decodeByteStream(handle.stdout)
        expect(out).toBe("test_value")
      }),
    )

    fx.effect(
      "passes multiple environment variables",
      Effect.gen(function* () {
        const handle = yield* js(
          "process.stdout.write(`${process.env.VAR1}-${process.env.VAR2}-${process.env.VAR3}`)",
          {
            env: { VAR1: "one", VAR2: "two", VAR3: "three" },
            extendEnv: true,
          },
        )
        const out = yield* decodeByteStream(handle.stdout)
        expect(out).toBe("one-two-three")
      }),
    )
  })

  describe("stderr", () => {
    fx.effect(
      "captures stderr output",
      Effect.gen(function* () {
        const handle = yield* js('process.stderr.write("error message")')
        const err = yield* decodeByteStream(handle.stderr)
        expect(err).toBe("error message")
      }),
    )

    fx.effect(
      "captures both stdout and stderr",
      Effect.gen(function* () {
        const handle = yield* js(
          [
            "let pending = 2",
            "const done = () => {",
            "  pending -= 1",
            "  if (pending === 0) setTimeout(() => process.exit(0), 0)",
            "}",
            'process.stdout.write("stdout\\n", done)',
            'process.stderr.write("stderr\\n", done)',
          ].join("\n"),
        )
        const [stdout, stderr] = yield* Effect.all([decodeByteStream(handle.stdout), decodeByteStream(handle.stderr)])
        expect(stdout).toBe("stdout")
        expect(stderr).toBe("stderr")
      }),
    )
  })

  describe("combined output (all)", () => {
    fx.effect(
      "captures stdout via .all when no stderr",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("hello from stdout")')
        const all = yield* decodeByteStream(handle.all)
        expect(all).toBe("hello from stdout")
      }),
    )

    fx.effect(
      "captures stderr via .all when no stdout",
      Effect.gen(function* () {
        const handle = yield* js('process.stderr.write("hello from stderr")')
        const all = yield* decodeByteStream(handle.all)
        expect(all).toBe("hello from stderr")
      }),
    )
  })

  describe("stdin", () => {
    fx.effect(
      "allows providing standard input to a command",
      Effect.gen(function* () {
        const input = "a b c"
        const stdin = Stream.make(Buffer.from(input, "utf-8"))
        const handle = yield* js(
          'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
          { stdin },
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toBe("a b c")
      }),
    )
  })

  describe("process control", () => {
    fx.effect(
      "kills a running process",
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const handle = yield* js("setTimeout(() => {}, 10_000)")
            yield* handle.kill()
            return yield* handle.exitCode
          }),
        )
        expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
      }),
    )

    fx.effect(
      "kills a child when scope exits",
      Effect.gen(function* () {
        const pid = yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* js("setInterval(() => {}, 10_000)")
            return Number(handle.pid)
          }),
        )
        const done = yield* Effect.promise(() => gone(pid))
        expect(done).toBe(true)
      }),
    )

    fx.effect(
      "forceKillAfter escalates for stubborn processes",
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const started = Date.now()
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const handle = yield* js('process.on("SIGTERM", () => {}); setInterval(() => {}, 10_000)')
            yield* handle.kill({ forceKillAfter: 100 })
            return yield* handle.exitCode
          }),
        )

        expect(Date.now() - started).toBeLessThan(1_000)
        expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
      }),
    )

    fx.effect(
      "isRunning reflects process state",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("done")')
        yield* handle.exitCode
        const running = yield* handle.isRunning
        expect(running).toBe(false)
      }),
    )
  })

  describe("error handling", () => {
    fx.effect(
      "fails for invalid command",
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const handle = yield* ChildProcess.make("nonexistent-command-12345")
            return yield* handle.exitCode
          }),
        )
        expect(Exit.isFailure(exit) ? true : exit.value !== ChildProcessSpawner.ExitCode(0)).toBe(true)
      }),
    )
  })

  describe("pipeline", () => {
    fx.effect(
      "pipes stdout of one command to stdin of another",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("hello world")').pipe(
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out.toUpperCase()))',
            ),
          ),
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toBe("HELLO WORLD")
      }),
    )

    fx.effect(
      "three-stage pipeline",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("hello world")').pipe(
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out.toUpperCase()))',
            ),
          ),
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out.replaceAll(" ", "-")))',
            ),
          ),
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toBe("HELLO-WORLD")
      }),
    )

    fx.effect(
      "pipes stderr with { from: 'stderr' }",
      Effect.gen(function* () {
        const handle = yield* js('process.stderr.write("error")').pipe(
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
            ),
            { from: "stderr" },
          ),
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toBe("error")
      }),
    )

    fx.effect(
      "pipes combined output with { from: 'all' }",
      Effect.gen(function* () {
        const handle = yield* js('process.stdout.write("stdout\\n"); process.stderr.write("stderr\\n")').pipe(
          ChildProcess.pipeTo(
            js(
              'process.stdin.setEncoding("utf8"); let out = ""; process.stdin.on("data", (chunk) => out += chunk); process.stdin.on("end", () => process.stdout.write(out))',
            ),
            { from: "all" },
          ),
        )
        const out = yield* decodeByteStream(handle.stdout)
        yield* handle.exitCode
        expect(out).toContain("stdout")
        expect(out).toContain("stderr")
      }),
    )
  })

  describe("Windows-specific", () => {
    fx.effect(
      "uses shell routing on Windows",
      Effect.gen(function* () {
        if (process.platform !== "win32") return

        const out = yield* ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.string(
            ChildProcess.make("set", ["UNIFIA_TEST_SHELL"], {
              shell: true,
              extendEnv: true,
              env: { UNIFIA_TEST_SHELL: "ok" },
            }),
          ),
        )
        expect(out).toContain("UNIFIA_TEST_SHELL=ok")
      }),
    )

    fx.effect(
      "runs cmd scripts with spaces on Windows without shell",
      Effect.gen(function* () {
        if (process.platform !== "win32") return

        const tmp = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        )
        const dir = path.join(tmp.path, "with space")
        const file = path.join(dir, "echo cmd.cmd")

        yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
        yield* Effect.promise(() => Bun.write(file, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n"))

        const code = yield* ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
          svc.exitCode(
            ChildProcess.make(file, ["--stdio"], {
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            }),
          ),
        )
        expect(code).toBe(ChildProcessSpawner.ExitCode(0))
      }),
    )
  })
})

/**
 * A parent that starts a grandchild in its own session (`detached: true` makes
 * it call setsid, so it leaves the parent's process group). The grandchild
 * inherits stdout, so the pipe stays open after the parent is gone. Node's
 * 'close' event waits for every stdio stream to end, so it cannot fire until
 * the grandchild exits. Options: the grandchild or the parent ignores SIGTERM,
 * or the parent exits right away and leaves the grandchild orphaned.
 */
function escapee(
  pidFile: string,
  opts: { parentIgnoresSigterm?: boolean; grandchildIgnoresSigterm?: boolean; parentExits?: boolean } = {},
) {
  const tmp = JSON.stringify(pidFile + ".tmp")
  const grandchild = opts.grandchildIgnoresSigterm
    ? 'process.on("SIGTERM", () => {}); setInterval(() => {}, 10000)'
    : "setInterval(() => {}, 10000)"
  return [
    'const fs = require("node:fs"); const { spawn } = require("node:child_process");',
    opts.parentIgnoresSigterm ? 'process.on("SIGTERM", () => {});' : "",
    `const child = spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { detached: true, stdio: ["ignore", "inherit", "ignore"] });`,
    "child.unref();",
    `fs.writeFileSync(${tmp}, String(child.pid)); fs.renameSync(${tmp}, ${JSON.stringify(pidFile)});`,
    opts.parentExits ? "process.exit(0);" : "setInterval(() => {}, 10000);",
  ].join("\n")
}

async function readPid(file: string) {
  const end = Date.now() + 10_000
  while (Date.now() < end) {
    const pid = Number(await fs.readFile(file, "utf8").catch(() => ""))
    if (Number.isInteger(pid) && pid > 0) return pid
    await Bun.sleep(20)
  }
  throw new Error("grandchild never reported its pid")
}

function reap(pid: number | undefined) {
  if (pid === undefined) return
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // already gone
  }
}

describe("bounded release when a grandchild escapes the process group", () => {
  const releaseCase = (label: string, opts: { grandchildIgnoresSigterm?: boolean; parentExits?: boolean }) =>
    fx.live(
      label,
      Effect.gen(function* () {
        if (process.platform === "win32") return
        const dir = yield* Effect.promise(() => tmpdir())
        const pidFile = path.join(dir.path, "grandchild.pid")
        let grandchild: number | undefined
        let parent: number | undefined
        let isRunning: Effect.Effect<boolean, PlatformError.PlatformError> | undefined
        let stop = () => {}
        const stopped = new Promise<void>((resolve) => (stop = resolve))

        const scoped = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* js(escapee(pidFile, opts))
              parent = Number(handle.pid)
              isRunning = handle.isRunning
              yield* Effect.promise(() => stopped)
            }),
          ),
        )

        const body = Effect.gen(function* () {
          grandchild = yield* Effect.promise(() => readPid(pidFile))
          if (opts.parentExits) expect(yield* Effect.promise(() => gone(parent!, 10_000))).toBe(true)
          stop()
          const outcome = yield* Fiber.await(scoped).pipe(
            Effect.map((exit) => (Exit.isSuccess(exit) ? "released" : "failed")),
            Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed("still waiting after 10s") }),
          )
          expect(outcome).toBe("released")
          // The exit signal must fire: directly on 'close', or shortly after the stdio fallback.
          const until = Date.now() + 2_000
          while (Date.now() < until && (yield* isRunning!)) yield* Effect.sleep("20 millis")
          expect(yield* isRunning!).toBe(false)
        })

        yield* body.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              stop()
              reap(grandchild)
            }),
          ),
        )
      }),
    )

  releaseCase("scope release completes when the grandchild keeps stdout open after the parent is stopped", {})
  releaseCase("scope release completes when the grandchild also ignores SIGTERM", { grandchildIgnoresSigterm: true })
  releaseCase("scope release completes when the parent already exited and the orphan holds stdout", {
    parentExits: true,
  })

  fx.live(
    "forceKillAfter kill completes when the parent ignores SIGTERM and the grandchild keeps stdout open",
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const dir = yield* Effect.promise(() => tmpdir())
      const pidFile = path.join(dir.path, "grandchild.pid")
      let grandchild: number | undefined

      const body = Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* js(escapee(pidFile, { parentIgnoresSigterm: true }))
          grandchild = yield* Effect.promise(() => readPid(pidFile))
          const outcome = yield* handle.kill({ forceKillAfter: 300 }).pipe(
            Effect.map(() => "killed"),
            Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed("still waiting after 10s") }),
          )
          expect(outcome).toBe("killed")
        }),
      )

      yield* body.pipe(Effect.ensuring(Effect.sync(() => reap(grandchild))))
    }),
  )
})
