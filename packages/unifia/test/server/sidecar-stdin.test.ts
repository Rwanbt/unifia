/* SPDX-License-Identifier: MIT */
/**
 * The desktop host's credential channel: one JSON line on the sidecar's stdin, never in its environment or command line.
 *
 * The unit tests drive the reader with a real stream. The integration tests start the real CLI as `serve`, and read the
 * process's own /proc entries, so they check what another process of the same user can see. A control start that uses the
 * environment is run too: without it, "the password is not visible" would prove nothing.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { PassThrough } from "node:stream"
import path from "node:path"
import { parseCredentialLine, readCredentialLine } from "../../src/server/sidecar-credentials"
import { heldCredentials, holdCredentials } from "../../src/flag/held-credentials"
import { tmpdir } from "../fixture/fixture"

const PASSWORD = "stdin-password-0123456789-abcdef"
const CLI = path.resolve(import.meta.dir, "../../src/index.ts")
const AUTH = `Basic ${Buffer.from(`unifia:${PASSWORD}`).toString("base64")}`

afterEach(() => holdCredentials({}))

describe("the credential line", () => {
  test("accepts the three known string fields", () => {
    expect(parseCredentialLine(JSON.stringify({ username: "u", password: "p", keychainToken: "t" }))).toEqual({
      username: "u",
      password: "p",
      keychainToken: "t",
    })
  })

  test("refuses an unknown field, a non-string field, a non-object and text that is not JSON", () => {
    expect(() => parseCredentialLine(JSON.stringify({ password: "p", extra: "x" }))).toThrow("unknown credential field")
    expect(() => parseCredentialLine(JSON.stringify({ password: 1 }))).toThrow("not a string")
    expect(() => parseCredentialLine("[]")).toThrow("not an object")
    expect(() => parseCredentialLine("hello")).toThrow("not JSON")
  })

  test("reads one line from stdin, holds the values, and leaves the stream paused", async () => {
    const stream = new PassThrough()
    const pending = readCredentialLine(stream, 1_000)
    stream.write(`${JSON.stringify({ username: "owner", password: PASSWORD })}\n`)
    expect(await pending).toEqual({ username: "owner", password: PASSWORD })
    expect(heldCredentials().password).toBe(PASSWORD)
    expect(stream.isPaused()).toBe(true)
  })

  test("fails closed when the stream ends before a line arrives", async () => {
    const stream = new PassThrough()
    const pending = readCredentialLine(stream, 1_000)
    stream.end()
    await expect(pending).rejects.toThrow("stdin closed before the credentials arrived")
    expect(heldCredentials().password).toBeUndefined()
  })

  test("fails closed when no line arrives within the timeout", async () => {
    const stream = new PassThrough()
    await expect(readCredentialLine(stream, 50)).rejects.toThrow("no credentials arrived")
  })

  test("fails closed on a line that is too long, before it is parsed", async () => {
    const stream = new PassThrough()
    const pending = readCredentialLine(stream, 1_000)
    stream.write("x".repeat(64 * 1024 + 1))
    await expect(pending).rejects.toThrow("too long")
  })
})

describe("the server with the credential channel", () => {
  /** Start the real CLI. The credential line, when given, is written at once: the server waits for it before listening. */
  function startServe(cwd: string, options: { env?: Record<string, string>; credentialsStdin?: boolean } = {}) {
    const env = { ...(process.env as Record<string, string>), ...options.env }
    const args = [CLI, "serve", "--hostname", "127.0.0.1", "--port", "0"]
    if (options.credentialsStdin ?? true) args.push("--credentials-stdin")
    const proc = Bun.spawn([process.execPath, ...args], { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
    const output = { stdout: "", stderr: "" }
    const collect = (stream: ReadableStream<Uint8Array>, key: "stdout" | "stderr") =>
      (async () => {
        const decoder = new TextDecoder()
        const reader = stream.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          output[key] += decoder.decode(value, { stream: true })
        }
      })().catch(() => {})
    void collect(proc.stdout, "stdout")
    void collect(proc.stderr, "stderr")
    return { proc, output }
  }

  /** The port the server reports once it is listening; fails the test if it exits first or takes too long. */
  async function waitForPort(run: ReturnType<typeof startServe>): Promise<number> {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(run.output.stdout)
      if (match) return Number(match[1])
      if (run.proc.exitCode !== null) throw new Error(`server exited ${run.proc.exitCode}: ${run.output.stderr.slice(-400)}`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`server did not listen: ${run.output.stderr.slice(-400)}`)
  }

  test("the password arrives on stdin and authenticates requests; a request without it is refused", async () => {
    await using project = await tmpdir({ git: true })
    const run = startServe(project.path)
    try {
      run.proc.stdin.write(`${JSON.stringify({ username: "unifia", password: PASSWORD })}\n`)
      run.proc.stdin.flush()
      const port = await waitForPort(run)
      const anonymous = await fetch(`http://127.0.0.1:${port}/session`)
      expect(anonymous.status).toBe(401)
      const authenticated = await fetch(`http://127.0.0.1:${port}/session`, { headers: { Authorization: AUTH } })
      expect(authenticated.status).not.toBe(401)
    } finally {
      run.proc.kill()
      await run.proc.exited
    }
  })

  test.skipIf(process.platform !== "linux")(
    "the password is in neither the environment nor the command line of the server process",
    async () => {
      await using project = await tmpdir({ git: true })
      const run = startServe(project.path)
      try {
        run.proc.stdin.write(`${JSON.stringify({ username: "unifia", password: PASSWORD })}\n`)
        run.proc.stdin.flush()
        const port = await waitForPort(run)
        expect((await fetch(`http://127.0.0.1:${port}/session`, { headers: { Authorization: AUTH } })).status).not.toBe(401)
        const environ = readFileSync(`/proc/${run.proc.pid}/environ`, "utf8")
        const cmdline = readFileSync(`/proc/${run.proc.pid}/cmdline`, "utf8")
        expect(environ.includes(PASSWORD)).toBe(false)
        expect(cmdline.includes(PASSWORD)).toBe(false)
      } finally {
        run.proc.kill()
        await run.proc.exited
      }
    },
  )

  test.skipIf(process.platform !== "linux")(
    "control: the environment start does put the password in the server's environment",
    async () => {
      await using project = await tmpdir({ git: true })
      const run = startServe(project.path, { credentialsStdin: false, env: { UNIFIA_SERVER_PASSWORD: PASSWORD } })
      try {
        const port = await waitForPort(run)
        expect((await fetch(`http://127.0.0.1:${port}/session`, { headers: { Authorization: AUTH } })).status).not.toBe(401)
        expect(readFileSync(`/proc/${run.proc.pid}/environ`, "utf8").includes(PASSWORD)).toBe(true)
      } finally {
        run.proc.kill()
        await run.proc.exited
      }
    },
  )

  test("a host that closes stdin before sending credentials stops the server with an error", async () => {
    await using project = await tmpdir({ git: true })
    const run = startServe(project.path)
    run.proc.stdin.end()
    const code = await run.proc.exited
    expect(code).toBe(1)
    expect(run.output.stderr).toContain("stdin closed before the credentials arrived")
    expect(run.output.stdout).not.toContain("listening on")
  })

  test("a line that is not credentials stops the server with an error, and nothing listens", async () => {
    await using project = await tmpdir({ git: true })
    const run = startServe(project.path)
    run.proc.stdin.write("not credentials\n")
    run.proc.stdin.flush()
    const code = await run.proc.exited
    expect(code).toBe(1)
    expect(run.output.stderr).toContain("not JSON")
    expect(run.output.stdout).not.toContain("listening on")
  })

  test("nothing from an earlier server is kept: a new server without a line does not start", async () => {
    await using project = await tmpdir({ git: true })
    const first = startServe(project.path)
    try {
      first.proc.stdin.write(`${JSON.stringify({ username: "unifia", password: PASSWORD })}\n`)
      first.proc.stdin.flush()
      await waitForPort(first)
    } finally {
      first.proc.kill()
      await first.proc.exited
    }
    const second = startServe(project.path)
    second.proc.stdin.end()
    expect(await second.proc.exited).toBe(1)
    expect(second.output.stdout).not.toContain("listening on")
  })
})

describe("the reader and the refusals, on bytes", () => {
  test("a line too long is refused even when its newline arrives in the same chunk", async () => {
    const stream = new PassThrough()
    const pending = readCredentialLine(stream as unknown as NodeJS.ReadableStream, 2000)
    stream.write(`${JSON.stringify({ password: "x".repeat(100 * 1024) })}\n`)
    await expect(pending).rejects.toThrow("too long")
  })

  test("a character split across two chunks is read whole", async () => {
    const stream = new PassThrough()
    const pending = readCredentialLine(stream as unknown as NodeJS.ReadableStream, 2000)
    const bytes = Buffer.from(`${JSON.stringify({ password: "é€🙂" })}\n`, "utf8")
    // 14 bytes: the first part ends inside the two-byte "é".
    stream.write(bytes.subarray(0, 14))
    stream.write(bytes.subarray(14))
    await expect(pending).resolves.toEqual({ password: "é€🙂" })
  })

  test("an empty password is refused, so no server starts without one", () => {
    expect(() => parseCredentialLine(JSON.stringify({ password: "" }))).toThrow("empty")
  })

  test("a value placed in a key name is not in the refusal", () => {
    const secret = "sk-key-name-secret-value"
    let caught = ""
    try {
      parseCredentialLine(JSON.stringify({ [secret]: "x" }))
    } catch (error) {
      caught = (error as Error).message
    }
    expect(caught).toContain("unknown credential field")
    expect(caught).not.toContain(secret)
  })
})

describe("the desktop path reaches the Workbench without the password in the environment", () => {
  test("a password held from stdin opens the Workbench bridge, with no environment copy", async () => {
    const { createWorkbenchBridge } = await import("../../src/server/workbench")
    const before = process.env.UNIFIA_SERVER_PASSWORD
    delete process.env.UNIFIA_SERVER_PASSWORD
    try {
      holdCredentials({ password: PASSWORD })
      expect(createWorkbenchBridge()).toBeDefined()
    } finally {
      if (before !== undefined) process.env.UNIFIA_SERVER_PASSWORD = before
    }
  })
})
