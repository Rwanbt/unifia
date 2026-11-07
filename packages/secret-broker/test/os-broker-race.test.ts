/* SPDX-License-Identifier: MIT */
// Contenders are separate processes, not worker_threads: on Linux, Bun 1.3.11
// segfaults when an eval'd worker imports a TypeScript module (CI run
// 42394646962). Processes are also what races in production: several app
// processes opening the same broker storage.
import { expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createOsBroker } from "../src/os-broker.js"
import type { OwnershipScope } from "../src/index.js"

// Two contenders already race; six make the overlap likely without spawning a
// dozen full Bun runtimes on memory-constrained runners.
const CONCURRENT_BROKER_COUNT = 6
const CONTENDER_TIMEOUT_MS = 30_000
const CONTENDER_SCRIPT = path.join(import.meta.dir, "os-broker-race.child.ts")
const CREDENTIAL_SCOPE: OwnershipScope = { organizationId: "race-org", workspaceId: "race-workspace" }

type Contender = { process: Bun.Subprocess<"pipe", "pipe", "pipe">; lines: AsyncIterator<string> }

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffered = ""
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk)
    let newline = buffered.indexOf("\n")
    while (newline !== -1) {
      yield buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf("\n")
    }
  }
}

async function expectLine(contender: Contender, id: number, expected: string): Promise<void> {
  const next = await Promise.race([
    contender.lines.next(),
    Bun.sleep(CONTENDER_TIMEOUT_MS).then(() => ({ done: true as const, value: undefined })),
  ])
  if (next.done || next.value !== expected) {
    contender.process.kill()
    await contender.process.exited
    const stderr = await new Response(contender.process.stderr).text()
    throw new Error(`contender ${id} did not say "${expected}" (got ${String(next.value)}): ${stderr}`)
  }
}

test("concurrent broker startup shares one persisted salt across processes", async () => {
  const storageDir = await mkdtemp(path.join(tmpdir(), "unifia-os-broker-race-"))
  const rootKey = randomBytes(32).toString("base64")
  const contenders: Contender[] = []

  try {
    for (let id = 0; id < CONCURRENT_BROKER_COUNT; id += 1) {
      const child = Bun.spawn([process.execPath, CONTENDER_SCRIPT, String(id), rootKey, storageDir], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      contenders.push({ process: child, lines: readLines(child.stdout)[Symbol.asyncIterator]() })
    }

    await Promise.all(contenders.map((contender, id) => expectLine(contender, id, "ready")))
    for (const contender of contenders) {
      contender.process.stdin.write("go\n")
      await contender.process.stdin.flush()
    }
    await Promise.all(contenders.map((contender, id) => expectLine(contender, id, "done")))
    const exitCodes = await Promise.all(contenders.map((contender) => contender.process.exited))
    expect(exitCodes).toEqual(contenders.map(() => 0))

    const broker = createOsBroker({ rootKey: Buffer.from(rootKey, "base64"), storageDir, allowInsecureFallback: true })
    for (let id = 0; id < CONCURRENT_BROKER_COUNT; id += 1) {
      const ref = { kind: "credential" as const, credentialId: `race-${id}`, scope: CREDENTIAL_SCOPE }
      const material = await broker.resolveCredential(ref, CREDENTIAL_SCOPE)
      expect(new TextDecoder("utf-8", { fatal: true }).decode(material as Uint8Array)).toBe(`secret-${id}`)
    }
  } finally {
    for (const contender of contenders) contender.process.kill()
    await Promise.all(contenders.map((contender) => contender.process.exited))
    await rm(storageDir, { recursive: true, force: true })
  }
}, 120_000)
