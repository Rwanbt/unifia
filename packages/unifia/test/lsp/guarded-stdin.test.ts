/* SPDX-License-Identifier: MIT */

import { beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "path"
import { PassThrough } from "node:stream"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import { LSPClient } from "../../src/lsp/client"
import { guardLanguageServerStdin } from "../../src/lsp/guarded-stdin"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

// vscode-jsonrpc's own write failure surfaces asynchronously, after the
// caller's rejection. bun test reports such a stray rejection as
// "Unhandled error between tests" and fails the run, so the guarded tests
// below only need to give it the time to surface.
const UNHANDLED_REJECTION_WINDOW_MS = 100

const settleStrayRejections = () => new Promise((r) => setTimeout(r, UNHANDLED_REJECTION_WINDOW_MS))

function spawnFakeServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return { process: spawn(process.execPath, [serverPath], { stdio: "pipe" }) }
}

describe("guarded language server stdin", () => {
  beforeEach(async () => {
    await Log.init({ print: false })
  })

  test("GuardedStdin_LiveStream_ForwardsWrites", async () => {
    const stream = new PassThrough()
    let gone = 0
    const stdin = guardLanguageServerStdin(stream, () => gone++)

    await new Promise<void>((resolve, reject) => stdin.write("payload", "ascii", (e) => (e ? reject(e) : resolve())))

    expect(stream.read()?.toString()).toBe("payload")
    expect(gone).toBe(0)
  })

  test("GuardedStdin_DestroyedStream_ReportsLossInsteadOfFailingTheWrite", async () => {
    const stream = new PassThrough()
    let gone = 0
    const stdin = guardLanguageServerStdin(stream, () => gone++)
    stream.destroy()

    const error = await new Promise<Error | null | undefined>((resolve) => stdin.write("payload", resolve))

    expect(error).toBeUndefined()
    expect(gone).toBe(1)
  })

  // Characterizes the vscode-jsonrpc defect the guard exists for. If a future
  // vscode-jsonrpc stops leaking here, this fails and the guard can be revisited.
  test("JsonRpc_UnguardedRequestOnDestroyedStdin_LeaksUnhandledRejection", () => {
    const fixture = path.join(__dirname, "../fixture/lsp/unguarded-request-leak.ts")
    const run = spawnSync(process.execPath, [fixture], { encoding: "utf8" })

    expect(run.status).toBe(0)
    expect(JSON.parse(run.stdout.trim())).toEqual(["ERR_STREAM_DESTROYED"])
  })

  test("JsonRpc_GuardedRequestOnDestroyedStdin_RejectsWithoutUnhandledRejection", async () => {
    const stdin = new PassThrough()
    const connection = createMessageConnection(
      new StreamMessageReader(new PassThrough()),
      new StreamMessageWriter(guardLanguageServerStdin(stdin, () => connection.dispose()) as any),
    )
    connection.listen()
    stdin.destroy()

    const outcome = await connection.sendRequest("shutdown").then(
      () => "resolved",
      () => "rejected",
    )
    await settleStrayRejections()

    expect(outcome).toBe("rejected")
  })

  test("LSPClient_RequestAfterServerStdinDestroyed_RejectsWithoutUnhandledRejection", async () => {
    const handle = spawnFakeServer()
    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    handle.process.stdin.destroy()
    const outcome = await client.connection.sendRequest("textDocument/hover", {}).then(
      () => "resolved",
      () => "rejected",
    )
    await settleStrayRejections()

    expect(outcome).toBe("rejected")
    await expect(client.shutdown()).resolves.toBeUndefined()
  })
})
