/* SPDX-License-Identifier: MIT */
/**
 * Process entry of the Node Browser host (ADR-089): `node --experimental-strip-types host-entry.ts <init-json>`.
 *
 * The server hands over everything the host needs as one JSON argument, so the
 * host reads no config file and opens no database. stdin carries request
 * frames, stdout carries response, event and ask frames, stderr is diagnostics.
 *
 * The host exits when stdin closes. A parent that was killed cannot send a
 * shutdown, and polling its pid is unreliable on Windows (a dead process stays
 * openable while a handle is held), so end-of-input is the only dependable
 * "my server is gone" signal.
 */
import { randomUUID } from "node:crypto"
// Subpath on purpose: the package root re-exports modules whose `.js` specifiers Node cannot resolve to `.ts` sources.
import { parseBrowserEgressPolicy } from "@unifia/contracts/browser"
import { BrowserHostProcess, type HostEnvironment } from "./host-main.ts"
import { createLineSplitter } from "./protocol.ts"

type HostInit = Omit<HostEnvironment, "createId" | "policy" | "onFatal" | "scanner"> & { policy: unknown }

function readInit(argument: string | undefined): HostEnvironment {
  if (!argument) throw new Error("the Browser host needs its init JSON as the first argument")
  const init = JSON.parse(argument) as HostInit
  if (typeof init.quarantineRoot !== "string" || init.quarantineRoot.length === 0) {
    throw new Error("the Browser host init has no quarantineRoot")
  }
  return { ...init, policy: parseBrowserEgressPolicy(init.policy), createId: () => randomUUID() }
}

async function main(): Promise<void> {
  const host = new BrowserHostProcess(readInit(process.argv[2]))
  host.attach((line) => {
    process.stdout.write(line)
  })
  const split = createLineSplitter((line) => {
    void host.receive(line)
  })
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", split)
  process.stdin.on("end", () => {
    host
      .close()
      .catch((error) => process.stderr.write(`unifia-browser-host: shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`))
      .finally(() => process.exit(0))
  })
}

main().catch((error) => {
  process.stderr.write(`unifia-browser-host: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
