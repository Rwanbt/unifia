/* SPDX-License-Identifier: MIT */

import type { Writable } from "node:stream"

type WriteCallback = (error?: Error | null) => void
type Listener = (...args: any[]) => void

function isStreamDestroyedError(error: Error | null | undefined) {
  return (error as NodeJS.ErrnoException | null | undefined)?.code === "ERR_STREAM_DESTROYED"
}

/**
 * Wraps a language server's stdin for vscode-jsonrpc's StreamMessageWriter.
 *
 * vscode-jsonrpc 8.2.1's sendRequest rethrows a failed write from inside an
 * async Promise executor, so a request written onto a destroyed stdin always
 * leaves an unhandled ERR_STREAM_DESTROYED rejection that no caller can catch.
 * The guard never hands that failure to the writer: it reports the lost stream
 * instead, and the owner disposes the connection, which rejects every pending
 * request through the normal, catchable path.
 */
export function guardLanguageServerStdin(stdin: Writable, onStreamGone: () => void) {
  const isGone = () => stdin.destroyed || stdin.writableEnded
  const settle = (done: WriteCallback | undefined) => (error?: Error | null) => {
    if (!isStreamDestroyedError(error)) return done?.(error)
    onStreamGone()
    done?.()
  }

  return {
    on(event: string, listener: Listener) {
      stdin.on(event, listener)
    },
    off(event: string, listener: Listener) {
      stdin.off(event, listener)
    },
    end() {
      if (!isGone()) stdin.end()
    },
    write(data: string | Uint8Array, encodingOrDone?: BufferEncoding | WriteCallback, done?: WriteCallback) {
      const callback = typeof encodingOrDone === "function" ? encodingOrDone : done
      if (isGone()) {
        onStreamGone()
        callback?.()
        return false
      }
      if (typeof encodingOrDone === "string") return stdin.write(data, encodingOrDone, settle(callback))
      return stdin.write(data, settle(callback))
    },
  }
}
