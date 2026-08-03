/* SPDX-License-Identifier: MIT */
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ArtifactStore } from "@unifia/artifact-runtime"
import { DOCUMENT_PACK_MANIFESTS, DocumentPackRegistry, registerBuiltInDocumentWorkers } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-packs-"))
try {
  const store = new ArtifactStore(root, () => 5_000)
  const registry = new DocumentPackRegistry(store)
  registerBuiltInDocumentWorkers(registry)
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
  const pdf = await registry.execute("unifia.document.pdf", "ws-1", "hello")
  if (pdf.kind !== "pdf" || pdf.filename !== "document.pdf") throw new Error("PDF worker output is invalid")
  const bytes = await store.read(pdf)
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== "23b19e6c4315b0ec5310a1bd12e19690378dc4138aec3a8a9df48f9b8c85bf97") throw new Error(`PDF golden mismatch: ${digest}`)
  if (!Buffer.from(bytes).subarray(0, 8).toString().startsWith("%PDF-1.4")) throw new Error("PDF header missing")
  console.log("DocumentPackRegistry: 6/6 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}

