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
  const formats = ["docx", "xlsx", "pptx"] as const
  for (const format of formats) {
    const artifact = await registry.execute(`unifia.document.${format}`, "ws-1", `hello ${format}`)
    const bytes = await store.read(artifact)
    const digest = createHash("sha256").update(bytes).digest("hex")
    const golden = { docx: "01264d58430a65a6cae1326fbb0c9b728de5b435ae5c8e82afb9dbb9f70a7973", xlsx: "e83bac85c04569c9f00d6f2b3d515b6871b1221198f56bb2117a8d619615ccd9", pptx: "4b6a37f98adf6f3d65ea214701d75a6e203a92e79279c87ffb0e663dffcdd0af" }
    if (digest !== golden[format]) throw new Error(`${format} golden mismatch: ${digest}`)
    if (artifact.kind !== format || Buffer.from(bytes).subarray(0, 2).toString() !== "PK") throw new Error(`${format} OOXML artifact is invalid`)
  }
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

