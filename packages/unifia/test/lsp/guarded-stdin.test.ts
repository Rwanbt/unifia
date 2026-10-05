/* SPDX-License-Identifier: MIT */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { PassThrough } from "node:stream"
import { LSPClient } from "../../src/lsp/client"
import { guardLanguageServerStdin } from "../../src/lsp/guarded-stdin"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

// vscode-jsonrpc's own write failure surfaces asynchronously, after the
// caller's rejection, so the listener needs a short window to observe it.
const UNHANDLED_REJECTION_WINDOW_MS = 100

function spawnFakeServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return { process: spawn(process.execPath, [serverPath], { stdio: "pipe" }) }
}

describe("guarded language server stdin", () => {
  const unhandled: unknown[] = []
  const recordUnhandled = (reason: unknown) => unhandled.push(reason)

  beforeEach(async () => {
    await Log.init({ print: false })
    unhandled.length = 0
    process.on("unhandledRejection", recordUnhandled)
  })

  afterEach(() => {
    process.off("unhandledRejection", recordUnhandled)
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
    await new Promise((r) => setTimeout(r, UNHANDLED_REJECTION_WINDOW_MS))

    expect(outcome).toBe("rejected")
    expect(unhandled).toEqual([])
    await expect(client.shutdown()).resolves.toBeUndefined()
  })
})
