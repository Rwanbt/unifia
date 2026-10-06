/* SPDX-License-Identifier: MIT */
import { describe, expect, test, beforeEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { LSPClient } from "../../src/lsp/client"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

// Reproducer for #284: an LSP server can exit on its own while writes are still
// queued behind vscode-jsonrpc's writer semaphore. Neither dispose() nor the
// connection's own close cancels entries already on that semaphore, so each one
// still reaches doWrite() -> writable.write() -> ril.js stream.write() on a pipe
// that is already gone. Measured on this platform, the resulting error is
// EPIPE (errno -32) on Windows / EOF (errno -136) elsewhere, and it is thrown
// out of stream.write() itself rather than delivered to the write callback --
// so no promise in our chain can see it and test/preload.ts's ERR_STREAM_DESTROYED
// guard does not match it. That is what fails `unit (windows)` with 0 failing tests.
//
// Test 1 owns the write transport so the crash lands on a chosen write and the
// evidence is a number. Test 2 runs the same scenario over a real child process
// and a real pipe, where reaching its assertion at all is the assertion.

function spawnServer(fixture: string, env?: Record<string, string>) {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/", fixture)
  return spawn(process.execPath, [serverPath], {
    stdio: "pipe",
    env: { ...process.env, ...env },
  })
}

// A writable that behaves like a child's stdin but is owned by the test, so the
// moment the server "dies" is deterministic instead of a timer race. It exposes
// only what vscode-jsonrpc's node RAL actually calls on a writable:
// on/off (for onClose/onError/onEnd), write(data[, encoding], callback) and end().
//
// Writes are forwarded to the real pipe while the server is alive, so the
// handshake completes for real. Once killed, writes are counted instead of
// forwarded -- that count is the evidence. `destroyed` deliberately stays false,
// because on this platform it still reads false in exactly the shapes that
// break CI, so a fix cannot pass by testing it.
class CountingStdin {
  writes = 0
  writesOnDeadStdin = 0
  destroyed = false
  dead = false
  private armed = false
  private writesSinceArm = 0
  private listeners = new Map<string, Set<(...args: any[]) => void>>()

  constructor(
    private readonly target: { write: (...args: any[]) => any; end: (...args: any[]) => any },
    private readonly killAfterWrite: number,
  ) {}

  // Called only once create() has returned, so the crash can never land inside
  // the handshake (which would reject create() and make the test vacuous).
  armKill() {
    this.armed = true
    this.writesSinceArm = 0
  }

  on(event: string, listener: (...args: any[]) => void) {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(listener)
    return this
  }

  once(event: string, listener: (...args: any[]) => void) {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper)
      listener(...args)
    }
    return this.on(event, wrapper)
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  removeListener(event: string, listener: (...args: any[]) => void) {
    return this.off(event, listener)
  }

  write(data: unknown, encoding?: unknown, cb?: unknown) {
    const done = typeof encoding === "function" ? encoding : typeof cb === "function" ? cb : undefined
    if (this.dead) {
      this.writesOnDeadStdin++
      // Still complete the write. vscode-jsonrpc serialises every write behind
      // one semaphore, so a write that never calls back would stall the whole
      // queue and the test would time out instead of reporting the count.
      if (typeof done === "function") setTimeout(() => done(), 0)
    } else if (encoding === undefined) {
      // Forward for real so the fake server keeps answering requests.
      this.target.write(data, cb)
    } else {
      this.target.write(data, encoding, cb)
    }
    this.writes++
    if (this.armed && !this.dead && ++this.writesSinceArm >= this.killAfterWrite) this.kill()
    return true
  }

  end() {
    if (this.dead) return
    this.target.end()
  }

  kill() {
    if (this.dead) return
    this.dead = true
    for (const listener of [...(this.listeners.get("close") ?? [])]) listener()
  }
}

const BURST = 128

describe("LSPClient with a server that dies mid-session (#284)", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  test("no queued write is handed to a dead stdin", async () => {
    const proc = spawnServer("fake-lsp-server.js") as any
    // Real process, synthetic stdin: the handshake still completes over the real
    // pipe, while the crash point is chosen by the test instead of a timer.
    const stdin = new CountingStdin(proc.stdin, 1)
    proc.stdin = stdin

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: { process: proc, initialization: undefined } as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lsp-dead-"))
    const file = path.join(dir, "a.ts")
    await fs.writeFile(file, "export const a = 1\n")
    try {
      // Arm only now: create() has returned, so the crash cannot land in the
      // handshake. Two notifications per open (didChangeWatchedFiles + didOpen)
      // leaves far more writes queued than the single one that kills.
      stdin.armKill()
      await Promise.allSettled(
        Array.from({ length: BURST }, () => client.notify.open({ path: file })),
      )
      await new Promise((r) => setTimeout(r, 50))

      // The server is gone, so nothing may reach the pipe any more -- and the
      // guard must not merely be "nothing tried", so require the writes to exist.
      expect(stdin.dead).toBe(true)
      expect(stdin.writes).toBeGreaterThan(0)
      expect(stdin.writesOnDeadStdin).toBe(0)
    } finally {
      proc.kill()
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }, 60_000)

  test("a real child process dying mid-burst raises no unhandled error", async () => {
    const proc = spawnServer("fake-lsp-server-exits-after-initialize.js", {
      FAKE_LSP_EXIT_DELAY_MS: "120",
    }) as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: { process: proc, initialization: undefined } as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lsp-dead-"))
    // ~256 KiB per didChange. 128 of them is ~32 MiB in flight, the size lane A
    // measured as never returning zero dead-stdin writes.
    const file = path.join(dir, "big.ts")
    await fs.writeFile(file, "export const a = 1\n".repeat(12_000))
    try {
      await client.notify.open({ path: file })
      const settled = await Promise.allSettled(
        Array.from({ length: BURST }, () => client.notify.open({ path: file })),
      )
      await new Promise((r) => setTimeout(r, 200))

      // Reaching here means no EPIPE/EOF escaped as an uncaught error: the
      // failure mode of #284 aborts the run from the write path instead.
      expect(settled.length).toBe(BURST)
    } finally {
      proc.kill()
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }, 60_000)
})
