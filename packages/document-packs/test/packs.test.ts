/* SPDX-License-Identifier: MIT */
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ArtifactStore } from "@unifia/artifact-runtime"
import { DOCUMENT_PACK_MANIFESTS, DocumentPackRegistry } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-packs-"))
try {
  const store = new ArtifactStore(root, () => 5_000)
  const registry = new DocumentPackRegistry(store)
  if (DOCUMENT_PACK_MANIFESTS.length !== 6 || DOCUMENT_PACK_MANIFESTS.some((manifest) => manifest.network !== "off" || !manifest.provenance || !manifest.license)) throw new Error("pack manifests are incomplete")
  registry.register({ ...DOCUMENT_PACK_MANIFESTS.find((manifest) => manifest.id === "unifia.document.inspect")!, outputKind: "text" }, async (input, context) => {
    if (context.network !== "off" || context.workspaceId !== "ws-1") throw new Error("worker context widened network")
    return { kind: "text", filename: "inspection.txt", content: typeof input === "string" ? input : new TextDecoder().decode(input) }
  })
  const artifact = await registry.execute("unifia.document.inspect", "ws-1", "hello")
  if (artifact.kind !== "text" || artifact.filename !== "inspection.txt") throw new Error("worker output was not registered as artifact")
  let unregistered = false
  try { await registry.execute("unifia.document.docx", "ws-1", "input") } catch { unregistered = true }
  if (!unregistered) throw new Error("unimplemented document worker was silently executed")
  console.log("DocumentPackRegistry: 4/4 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}