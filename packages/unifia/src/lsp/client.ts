import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { Log } from "../util/log"
import { Process } from "../util/process"
import { LANGUAGE_EXTENSIONS } from "./language"
import z from "zod"
import type { LSPServer } from "./server"
import { NamedError } from "@unifia/util/error"
import { withTimeout } from "../util/timeout"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

const DIAGNOSTICS_DEBOUNCE_MS = 150

export namespace LSPClient {
  const log = Log.create({ service: "lsp.client" })

  export type Info = NonNullable<Awaited<ReturnType<typeof create>>>

  export type Diagnostic = VSCodeDiagnostic

  export const InitializeError = NamedError.create(
    "LSPInitializeError",
    z.object({
      serverID: z.string(),
    }),
  )

  export const Event = {
    Diagnostics: BusEvent.define(
      "lsp.client.diagnostics",
      z.object({
        serverID: z.string(),
        path: z.string(),
      }),
    ),
  }

  export async function create(input: { serverID: string; server: LSPServer.Handle; root: string }) {
    const l = log.clone().tag("serverID", input.serverID)
    l.info("starting client")

    // FORK (LSP-DEAD-SERVER): a server can exit on its own while writes are still
    // queued behind vscode-jsonrpc's writer semaphore. Neither dispose() nor the
    // connection's own close cancels entries already on that semaphore, so each
    // one still reaches doWrite() -> writable.write() -> ril.js stream.write() on
    // a pipe that is already gone. The error does NOT come back through the write
    // callback, so no promise in our chain can see it: measured EPIPE (errno -32)
    // on Windows and EOF (errno -136) elsewhere, thrown out of write() itself at
    // vscode-jsonrpc/lib/node/ril.js:88 via lib/common/messageWriter.js:99. That is
    // what fails `unit (windows)` with 0 failing tests. See #284.
    //
    // `shuttingDown` is hoisted above this block so a dead server is
    // indistinguishable from a shutting-down one for notify.open(): that is what
    // stops *new* writes at the source. `serverGone` is the only signal reliably
    // set at the moment of the crash -- `stdin.destroyed` is still false in both
    // shapes that break CI (measured), and the connection's own close is processed
    // only after the queued writes have already gone out.
    let shuttingDown = false
    let serverGone = false
    // Held in a mutable holder rather than closed over `connection` directly: the
    // process/stream handlers below are registered BEFORE the connection is
    // built, so a `connection.dispose()` inside markServerGone would read that
    // binding in its temporal dead zone if anything fired early. The holder is
    // filled in immediately after construction, and markServerGone stays valid
    // (and inert) either way.
    let disposeConnection: (() => void) | undefined
    const markServerGone = () => {
      if (serverGone) return
      serverGone = true
      shuttingDown = true
      try {
        disposeConnection?.()
      } catch {}
    }

    const rawStdin = input.server.process.stdin as any
    const guardedStdin = {
      // A pass-through, and deliberately NOT a guard. WriteableStreamMessageWriter
      // registers its own 'error'/'close' listeners in its constructor, so treating
      // a registration as the event firing marks a perfectly healthy server dead
      // and breaks every LSP client. The events are observed on the raw stream
      // itself, below, via once().
      on(event: string, listener: (...args: any[]) => void) {
        return rawStdin.on(event, listener)
      },
      off(event: string, listener: (...args: any[]) => void) {
        return rawStdin.off(event, listener)
      },
      write(data: string | Buffer, encoding?: any, cb?: any) {
        if (serverGone || rawStdin.destroyed) {
          // Surface it on the promise chain rather than throwing out of write():
          // ril.js resolves/rejects its write promise from this callback, so the
          // rejection stays catchable by callers (LSP.touchFile already catches and
          // logs notify() rejections) instead of escaping the chain entirely.
          const err = Object.assign(new Error("LSP server process is gone"), {
            code: "ERR_STREAM_DESTROYED",
          })
          const done = typeof encoding === "function" ? encoding : typeof cb === "function" ? cb : undefined
          if (done) setTimeout(() => done(err), 0)
          return false
        }
        return rawStdin.write(data, encoding, cb)
      },
      end() {
        if (serverGone || rawStdin.destroyed) return
        return rawStdin.end()
      },
    }

    input.server.process.once?.("exit", markServerGone)
    input.server.process.once?.("close", markServerGone)
    rawStdin.once?.("close", markServerGone)
    rawStdin.once?.("end", markServerGone)
    rawStdin.once?.("error", markServerGone)

    const connection = createMessageConnection(
      new StreamMessageReader(input.server.process.stdout as any),
      new StreamMessageWriter(guardedStdin as any),
    )

    disposeConnection = () => connection.dispose()
    connection.onClose(markServerGone)
    connection.onError(markServerGone)

    const diagnostics = new Map<string, Diagnostic[]>()
    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      const filePath = Filesystem.normalizePath(fileURLToPath(params.uri))
      l.info("textDocument/publishDiagnostics", {
        path: filePath,
        count: params.diagnostics.length,
      })
      const exists = diagnostics.has(filePath)
      diagnostics.set(filePath, params.diagnostics)
      if (!exists && input.serverID === "typescript") return
      Bus.publish(Event.Diagnostics, { path: filePath, serverID: input.serverID })
    })
    connection.onRequest("window/workDoneProgress/create", (params) => {
      l.info("window/workDoneProgress/create", params)
      return null
    })
    connection.onRequest("workspace/configuration", async () => {
      // Return server initialization options
      return [input.server.initialization ?? {}]
    })
    connection.onRequest("client/registerCapability", async () => {})
    connection.onRequest("client/unregisterCapability", async () => {})
    connection.onRequest("workspace/workspaceFolders", async () => [
      {
        name: "workspace",
        uri: pathToFileURL(input.root).href,
      },
    ])
    connection.listen()

    l.info("sending initialize")
    await withTimeout(
      connection.sendRequest("initialize", {
        rootUri: pathToFileURL(input.root).href,
        processId: input.server.process.pid,
        workspaceFolders: [
          {
            name: "workspace",
            uri: pathToFileURL(input.root).href,
          },
        ],
        initializationOptions: {
          ...input.server.initialization,
        },
        capabilities: {
          window: {
            workDoneProgress: true,
          },
          workspace: {
            configuration: true,
            didChangeWatchedFiles: {
              dynamicRegistration: true,
            },
          },
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
            },
            publishDiagnostics: {
              versionSupport: true,
            },
          },
        },
      }),
      45_000,
    ).catch((err) => {
      l.error("initialize error", { error: err })
      // FORK (LSP-SAVE-LATENCY): a failed/timed-out initialize leaves
      // connection.listen()'s onRequest/onNotification handlers (e.g.
      // workspace/configuration) still registered. If the server sends one
      // of those after we've given up — or the caller kills the process in
      // response to this throw (ensureClient's catch) — a queued response
      // write can land on an already-destroyed stdin stream, surfacing as an
      // unhandled "Cannot call write after a stream was destroyed" rejection
      // outside this promise chain entirely (vscode-jsonrpc's own internal
      // write queue, not something our caller's .catch() can see). Disposing
      // here stops the connection from processing/writing anything further
      // before we ever throw.
      try {
        connection.dispose()
      } catch {}
      throw new InitializeError(
        { serverID: input.serverID },
        {
          cause: err,
        },
      )
    })

    await connection.sendNotification("initialized", {})

    if (input.server.initialization) {
      await connection.sendNotification("workspace/didChangeConfiguration", {
        settings: input.server.initialization,
      })
    }

    const files: {
      [path: string]: number
    } = {}

    // FORK (LSP-TEST-SUITE-REGRESSION): File.notifyWrite/notifyDelete call
    // LSP.touchFile() fire-and-forget (by design — must never block a save).
    // That write can still be mid-flight through vscode-jsonrpc's internal
    // writer queue when shutdown() tears down the connection, landing on an
    // already-destroyed stream (ERR_STREAM_DESTROYED). `shuttingDown` (declared
    // above, shared with the dead-server guard) stops new writes the instant
    // shutdown begins; `pending` lets shutdown() wait for whatever was already
    // in flight before it destroys the stream.
    const pending = new Set<Promise<unknown>>()
    function track<T>(p: Promise<T>): Promise<T> {
      pending.add(p)
      // FORK (LSP-DEAD-SERVER): deliberately not p.finally(). finally() returns a
      // NEW promise that rejects whenever p rejects, and nothing awaits that
      // derived promise -- so one failed notification surfaced as an unhandled
      // rejection outside every promise chain we control, which is the same
      // escape hatch #284 is about. Both branches here are cleanup only, so the
      // rejection stays observable solely through the returned p.
      p.then(
        () => pending.delete(p),
        () => pending.delete(p),
      )
      return p
    }

    const result = {
      root: input.root,
      get serverID() {
        return input.serverID
      },
      get connection() {
        return connection
      },
      notify: {
        async open(input: { path: string }) {
          if (shuttingDown) return
          input.path = path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path)
          const text = await Filesystem.readText(input.path)
          const extension = path.extname(input.path)
          const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"

          const version = files[input.path]
          if (version !== undefined) {
            if (shuttingDown) return
            log.info("workspace/didChangeWatchedFiles", input)
            await track(
              connection.sendNotification("workspace/didChangeWatchedFiles", {
                changes: [
                  {
                    uri: pathToFileURL(input.path).href,
                    type: 2, // Changed
                  },
                ],
              }),
            )

            if (shuttingDown) return
            const next = version + 1
            files[input.path] = next
            log.info("textDocument/didChange", {
              path: input.path,
              version: next,
            })
            await track(
              connection.sendNotification("textDocument/didChange", {
                textDocument: {
                  uri: pathToFileURL(input.path).href,
                  version: next,
                },
                contentChanges: [{ text }],
              }),
            )
            return
          }

          if (shuttingDown) return
          log.info("workspace/didChangeWatchedFiles", input)
          await track(
            connection.sendNotification("workspace/didChangeWatchedFiles", {
              changes: [
                {
                  uri: pathToFileURL(input.path).href,
                  type: 1, // Created
                },
              ],
            }),
          )

          if (shuttingDown) return
          log.info("textDocument/didOpen", input)
          diagnostics.delete(input.path)
          await track(
            connection.sendNotification("textDocument/didOpen", {
              textDocument: {
                uri: pathToFileURL(input.path).href,
                languageId,
                version: 0,
                text,
              },
            }),
          )
          files[input.path] = 0
          return
        },
      },
      get diagnostics() {
        return diagnostics
      },
      async waitForDiagnostics(input: { path: string }) {
        const normalizedPath = Filesystem.normalizePath(
          path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path),
        )
        log.info("waiting for diagnostics", { path: normalizedPath })
        let unsub: () => void
        let debounceTimer: ReturnType<typeof setTimeout> | undefined
        return await withTimeout(
          new Promise<void>((resolve) => {
            unsub = Bus.subscribe(Event.Diagnostics, (event) => {
              if (event.properties.path === normalizedPath && event.properties.serverID === result.serverID) {
                // Debounce to allow LSP to send follow-up diagnostics (e.g., semantic after syntax)
                if (debounceTimer) clearTimeout(debounceTimer)
                debounceTimer = setTimeout(() => {
                  log.info("got diagnostics", { path: normalizedPath })
                  unsub?.()
                  resolve()
                }, DIAGNOSTICS_DEBOUNCE_MS)
              }
            })
          }),
          3000,
        )
          .catch(() => {})
          .finally(() => {
            if (debounceTimer) clearTimeout(debounceTimer)
            unsub?.()
          })
      },
      async shutdown() {
        l.info("shutting down")
        // FORK (LSP-TEST-SUITE-REGRESSION): flip synchronously, before any
        // await — stops notify.open()'s per-write checks from starting new
        // writes from this point on. Then wait for whatever notify.open()
        // call was already mid-write (tracked in `pending`) so its write
        // lands before the connection is torn down below, instead of racing
        // connection.end()/dispose() and landing on a destroyed stream.
        shuttingDown = true
        await Promise.allSettled([...pending])
        // Send shutdown request to LSP server before closing the connection
        try { await withTimeout(connection.sendRequest("shutdown"), 2000) } catch {}
        // FORK (LSP-SAVE-LATENCY): sendNotification() returns a promise —
        // the message write happens asynchronously through the writer's
        // internal semaphore/queue, not synchronously on this call. The
        // previous `try { ... } catch {}` (no await) only guarded against a
        // SYNCHRONOUS throw; the actual write could still reject later,
        // after this function had already moved on to connection.end() /
        // dispose() a few lines down — an unhandled rejection with nothing
        // left to catch it. Must be awaited to actually catch it.
        try { await connection.sendNotification("exit") } catch {}
        // Disposing first stops new request handlers without closing stdin.
        // Closing the stream via connection.end() can race a response that a
        // handler already queued, which Bun reports as ERR_STREAM_DESTROYED.
        // The process shutdown below owns the stream close after that queue has
        // had a bounded chance to drain.
        try { connection.dispose() } catch {}
        await new Promise((r) => setTimeout(r, 50))
        await Process.stop(input.server.process).catch(() => {})
        l.info("shutdown")
      },
    }

    l.info("initialized")

    return result
  }
}
