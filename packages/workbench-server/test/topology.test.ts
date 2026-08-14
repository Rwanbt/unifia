/* SPDX-License-Identifier: MIT */
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createWorkbenchApp, loadConfigFromEnv, startWorkbench } from "../src/bootstrap.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-topology-"))
const key = "unifia-topology-signing-key-0123456789"
const log = path.join(root, ".unifia", "audit.jsonl")
try {
  const config = loadConfigFromEnv({ UNIFIA_WORKBENCH_SIGNING_KEY: key, UNIFIA_WORKBENCH_PORT: "0", UNIFIA_WORKBENCH_AUDIT_LOG: log })
  const first = await startWorkbench(config)
  let occupied = false
  try {
    await startWorkbench({ ...config, port: first.port })
  } catch {
    occupied = true
  }
  if (!occupied) throw new Error("a second server accepted an occupied port")

  const port = first.port
  await first.stop()
  const second = await startWorkbench({ ...config, port })
  if (second.port !== port) throw new Error("the server did not restart on the released port")
  if (second.instanceId === first.instanceId) throw new Error("the restarted server reused the previous process instance id")
  await second.stop()

  const app = createWorkbenchApp(config)
  if ((await app.server.shutdown()).length !== 0) throw new Error("an unstarted server did not shut down cleanly")
  console.log("WorkbenchTopology: 3/3 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}
