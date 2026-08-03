/* SPDX-License-Identifier: MIT */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { downgradeV1ToV0, migrateV0ToV1, WorkspaceStorage, type WorkspaceState } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-storage-"))
try {
  const storage = new WorkspaceStorage(root, () => 2_000)
  const legacy = { workspaceId: "ws-1", generation: 2, updatedAt: 1_000, metadata: { source: "legacy" } }
  const migrated = migrateV0ToV1(legacy)
  if (migrated.schemaVersion !== 1 || downgradeV1ToV0(migrated).workspaceId !== legacy.workspaceId) throw new Error("V0/V1 migration is not reversible")
  const initial = await storage.load("ws-1")
  if (initial.generation !== 0) throw new Error("missing state did not start at generation zero")
  const saved = await storage.save({ ...initial, metadata: { source: "test" } })
  if (saved.generation !== 1) throw new Error("save did not advance generation")
  const health = await storage.health("ws-1")
  if (!health.healthy || health.generation !== 1) throw new Error("healthy state was not reported")

  const stateDir = path.join(root, ".unifia")
  await mkdir(stateDir, { recursive: true })
  const recovered: WorkspaceState = { schemaVersion: 1, workspaceId: "ws-1", generation: 3, updatedAt: 3_000, metadata: { source: "recovery" } }
  await writeFile(path.join(stateDir, "workspace-state.json.tmp"), `${JSON.stringify(recovered)}\n`)
  const afterRecovery = await storage.recover("ws-1")
  if (afterRecovery.generation !== 3 || (await JSON.parse(await readFile(path.join(stateDir, "workspace-state.json"), "utf8"))).generation !== 3) throw new Error("valid temporary state was not recovered")
  console.log("WorkspaceStorage: 4/4 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}