/* SPDX-License-Identifier: MIT */
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { DurableQueue } from "@unifia/workspace-runtime"

export type ArtifactKind = "docx" | "pptx" | "xlsx" | "pdf" | "binary" | "text"
export type ArtifactVersion = {
  artifactId: string
  version: number
  kind: ArtifactKind
  filename: string
  relativePath: string
  sha256: string
  bytes: number
  createdAt: number
  metadata: Record<string, string>
}
export type ArtifactInput = { kind: ArtifactKind; filename: string; content: string | Uint8Array; metadata?: Record<string, string> }

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024

function hash(content: Uint8Array): string { return createHash("sha256").update(content).digest("hex") }
function safeFilename(filename: string): string {
  if (!filename || filename.includes("\0") || path.basename(filename) !== filename || filename === "." || filename === "..") throw new Error("artifact filename must be a single safe path component")
  return filename
}

export class ArtifactStore {
  readonly #root: string
  readonly #artifactsRoot: string
  readonly #outbox: DurableQueue<ArtifactVersion>
  readonly #now: () => number
  readonly #maxBytes: number

  constructor(root: string, now: () => number = Date.now, maxBytes = MAX_ARTIFACT_BYTES) {
    this.#root = root
    this.#artifactsRoot = path.join(root, ".unifia", "artifacts")
    this.#outbox = new DurableQueue<ArtifactVersion>(root)
    this.#now = now
    this.#maxBytes = maxBytes
  }

  async create(input: ArtifactInput): Promise<ArtifactVersion> {
    const filename = safeFilename(input.filename)
    const content = typeof input.content === "string" ? Buffer.from(input.content) : Buffer.from(input.content)
    if (content.byteLength > this.#maxBytes) throw new Error("artifact quota exceeded")
    const sha256 = hash(content)
    const artifactId = `artifact-${sha256.slice(0, 24)}`
    const relativePath = path.posix.join(".unifia", "artifacts", artifactId, filename)
    const target = path.join(this.#artifactsRoot, artifactId, filename)
    await fs.mkdir(path.dirname(target), { recursive: true })
    try { await fs.access(target); throw new Error("artifact version already exists") } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    const temporary = `${target}.${sha256.slice(0, 12)}.tmp`
    await fs.writeFile(temporary, content, { flag: "wx" })
    try { await fs.rename(temporary, target) } catch (error) { await fs.rm(temporary, { force: true }); throw error }
    const artifact: ArtifactVersion = { artifactId, version: 1, kind: input.kind, filename, relativePath, sha256, bytes: content.byteLength, createdAt: this.#now(), metadata: { ...(input.metadata ?? {}) } }
    await this.#outbox.enqueue("outbox", artifact)
    return artifact
  }

  async read(artifact: ArtifactVersion): Promise<Uint8Array> {
    const absolute = path.join(this.#root, artifact.relativePath)
    const content = await fs.readFile(absolute)
    if (hash(content) !== artifact.sha256) throw new Error("artifact hash mismatch")
    return content
  }

  async pending(afterSequence = 0): Promise<Array<{ sequence: number; payload: ArtifactVersion }>> {
    return this.#outbox.pending("outbox", afterSequence)
  }
}