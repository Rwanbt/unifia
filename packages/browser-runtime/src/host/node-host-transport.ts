/* SPDX-License-Identifier: MIT */
/**
 * Starts the Node Browser host as a child process and exposes it as a
 * `HostTransport` (ADR-089 §6).
 *
 * `child_process` rather than `Bun.spawn` so the same code runs under both
 * runtimes and in the Node e2e. The host binary is `UNIFIA_NODE_PATH`, else
 * `node` on PATH; the desktop sets the former to the Node it ships.
 */
import { spawn } from "node:child_process"
import type { HostSeed, HostTransport } from "./host-client.ts"

export type NodeHostLaunch = {
  /** Path to `host-entry.ts` (or its bundled form). */
  entry: string
  /** Everything in the host init except the sessions and storage, which come from the seed. */
  init: { policy: unknown; quarantineRoot: string; releasedRoot?: string }
  nodePath?: string
  /** `--experimental-strip-types` is required to run the `.ts` entry on Node 22; a bundled entry needs none. */
  stripTypes?: boolean
  env?: NodeJS.ProcessEnv
}

export function startNodeHost(launch: NodeHostLaunch, seed: HostSeed): HostTransport {
  const node = launch.nodePath ?? process.env.UNIFIA_NODE_PATH ?? "node"
  const init = JSON.stringify({ ...launch.init, sessions: seed.sessions, storage: seed.storage })
  const args = [...(launch.stripTypes === false ? [] : ["--experimental-strip-types"]), launch.entry, init]
  const child = spawn(node, args, {
    stdio: ["pipe", "pipe", "inherit"],
    env: launch.env ?? process.env,
    windowsHide: true,
  })
  child.stdout.setEncoding("utf8")
  let exited = false
  return {
    send: (line) => {
      if (!child.stdin.writable) throw new Error("the Browser host stdin is closed")
      child.stdin.write(line)
    },
    onData: (listener) => child.stdout.on("data", listener),
    onExit: (listener) => {
      const once = (reason: string) => {
        if (exited) return
        exited = true
        listener(reason)
      }
      child.once("exit", (code, signal) => once(signal ? `signal ${signal}` : `exit code ${code}`))
      // `error` covers a node binary that does not exist: no `exit` follows it.
      child.once("error", (error) => once(error.message))
    },
    // Closing stdin first lets the host shut Chromium down itself; the kill is the backstop.
    kill: () => {
      child.stdin.end()
      setTimeout(() => {
        if (!exited) child.kill()
      }, 2_000).unref()
    },
  }
}
