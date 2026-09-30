/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { createOsBroker } from "../src/os-broker.js"
import type { OwnershipScope } from "../src/index.js"

const CONCURRENT_BROKER_COUNT = 24
const WORKER_MESSAGE_TIMEOUT_MS = 30_000
const CREDENTIAL_SCOPE: OwnershipScope = { organizationId: "race-org", workspaceId: "race-workspace" }

type WorkerMessage = { type: "ready" | "done" | "error"; id: number; error?: string }

function waitForWorkerMessage(worker: Worker, id: number, type: WorkerMessage["type"]): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`secret-broker worker ${id} did not send ${type}`)), WORKER_MESSAGE_TIMEOUT_MS)
    worker.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    worker.once("message", (message: WorkerMessage) => {
      clearTimeout(timeout)
      if (message.id !== id) return reject(new Error(`secret-broker worker ${id} sent a message for worker ${message.id}`))
      if (message.type === "error") return reject(new Error(`secret-broker worker ${id} failed: ${message.error}`))
      if (message.type !== type) return reject(new Error(`secret-broker worker ${id} sent ${message.type}, expected ${type}`))
      resolve()
    })
  })
}

test("concurrent broker startup shares one persisted salt across workers", async () => {
  const storageDir = await mkdtemp(path.join(tmpdir(), "unifia-os-broker-race-"))
  const rootKey = randomBytes(32).toString("base64")
  const moduleUrl = new URL("../src/os-broker.ts", import.meta.url).href
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads")
    const { createOsBroker } = await import(workerData.moduleUrl)
    parentPort.postMessage({ type: "ready", id: workerData.id })
    parentPort.once("message", async () => {
      try {
        const broker = createOsBroker({ rootKey: Buffer.from(workerData.rootKey, "base64"), storageDir: workerData.storageDir, allowInsecureFallback: true })
        const ref = { kind: "credential", credentialId: "race-" + workerData.id, scope: { organizationId: "race-org", workspaceId: "race-workspace" } }
        await broker.storeCredential(ref, "secret-" + workerData.id, "credential-material")
        parentPort.postMessage({ type: "done", id: workerData.id })
      } catch (error) {
        parentPort.postMessage({ type: "error", id: workerData.id, error: error instanceof Error ? error.message : String(error) })
      }
      parentPort.close()
    })
  `
  const workers: Worker[] = []

  try {
    for (let id = 0; id < CONCURRENT_BROKER_COUNT; id += 1) {
      const worker = new Worker(workerSource, { eval: true, workerData: { id, moduleUrl, rootKey, storageDir } })
      worker.unref()
      workers.push(worker)
    }

    await Promise.all(workers.map((worker, id) => waitForWorkerMessage(worker, id, "ready")))
    workers.forEach((worker) => worker.postMessage({ start: true }))
    await Promise.all(workers.map((worker, id) => waitForWorkerMessage(worker, id, "done")))

    const broker = createOsBroker({ rootKey: Buffer.from(rootKey, "base64"), storageDir, allowInsecureFallback: true })
    for (let id = 0; id < CONCURRENT_BROKER_COUNT; id += 1) {
      const ref = { kind: "credential" as const, credentialId: `race-${id}`, scope: CREDENTIAL_SCOPE }
      const material = await broker.resolveCredential(ref, CREDENTIAL_SCOPE)
      expect(new TextDecoder("utf-8", { fatal: true }).decode(material as Uint8Array)).toBe(`secret-${id}`)
    }
  } finally {
    for (const worker of workers) {
      if (worker.threadId !== -1) void worker.terminate()
    }
    await rm(storageDir, { recursive: true, force: true })
  }
})
