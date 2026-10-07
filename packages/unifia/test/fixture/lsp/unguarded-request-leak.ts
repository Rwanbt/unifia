/* SPDX-License-Identifier: MIT */

// Runs outside bun test, which reports a stray rejection as a suite error
// before any process listener sees it. Prints the codes of the unhandled
// rejections left by one request written onto a destroyed stdin.
import { PassThrough } from "node:stream"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"

const UNHANDLED_REJECTION_WINDOW_MS = 100

const unhandled: unknown[] = []
process.on("unhandledRejection", (reason) => unhandled.push((reason as NodeJS.ErrnoException).code))

const stdin = new PassThrough()
const connection = createMessageConnection(new StreamMessageReader(new PassThrough()), new StreamMessageWriter(stdin))
connection.listen()
stdin.destroy()

await connection.sendRequest("shutdown").catch(() => undefined)
await new Promise((r) => setTimeout(r, UNHANDLED_REJECTION_WINDOW_MS))
connection.dispose()

console.log(JSON.stringify(unhandled))
