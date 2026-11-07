/* SPDX-License-Identifier: MIT */
// One contender in os-broker-race.test.ts. It loads the broker, says "ready",
// waits for the parent's "go" on stdin so every contender starts together,
// then stores one credential and says "done".
import { createOsBroker } from "../src/os-broker.js"

const [id, rootKey, storageDir] = process.argv.slice(2)

async function waitForGo(): Promise<void> {
  const decoder = new TextDecoder()
  let received = ""
  for await (const chunk of Bun.stdin.stream()) {
    received += decoder.decode(chunk)
    if (received.includes("go")) return
  }
  throw new Error("stdin closed before the start signal")
}

process.stdout.write("ready\n")
await waitForGo()
const broker = createOsBroker({ rootKey: Buffer.from(rootKey, "base64"), storageDir, allowInsecureFallback: true })
const ref = {
  kind: "credential" as const,
  credentialId: `race-${id}`,
  scope: { organizationId: "race-org", workspaceId: "race-workspace" },
}
await broker.storeCredential(ref, `secret-${id}`, "credential-material")
process.stdout.write("done\n")
