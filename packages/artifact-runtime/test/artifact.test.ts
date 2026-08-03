/* SPDX-License-Identifier: MIT */
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ArtifactStore } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-artifact-"))
try {
  const store = new ArtifactStore(root, () => 4_000, 100)
  const artifact = await store.create({ kind: "text", filename: "result.txt", content: "hello", metadata: { source: "test" } })
  if (artifact.version !== 1 || artifact.sha256.length !== 64 || artifact.relativePath.includes("..")) throw new Error("artifact manifest is invalid")
  if (new TextDecoder().decode(await store.read(artifact)) !== "hello") throw new Error("artifact read/hash validation failed")
  if ((await store.pending()).length !== 1) throw new Error("artifact was not published to outbox")
  let duplicate = false
  try { await store.create({ kind: "text", filename: "result.txt", content: "hello" }) } catch { duplicate = true }
  if (!duplicate) throw new Error("duplicate artifact was silently overwritten")
  let traversal = false
  try { await store.create({ kind: "text", filename: "../escape.txt", content: "no" }) } catch { traversal = true }
  if (!traversal) throw new Error("artifact traversal filename was accepted")
  let oversized = false
  try { await store.create({ kind: "text", filename: "large.txt", content: "x".repeat(101) }) } catch { oversized = true }
  if (!oversized) throw new Error("artifact quota was not enforced")
  console.log("ArtifactStore: 5/5 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}