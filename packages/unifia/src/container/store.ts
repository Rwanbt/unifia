/* SPDX-License-Identifier: MIT */
// Local OCI image store (ADR-098): verified blobs by digest, one unpacked
// rootfs per image digest, and the tags that point at them. A rootfs is
// built in a staging directory and only renamed into place once complete.
import fs from "node:fs"
import path from "node:path"
import { gunzipSync } from "node:zlib"
import { readTar } from "../toolchain/archive"
import { acquireLock } from "../toolchain/transaction"
import { applyLayer } from "./layer"
import { type Descriptor, type ImageReference, OciError, parseReference, verifyBlob } from "./oci"
import type { RegistryClient } from "./registry"

export interface ImageStoreOptions {
  readonly state: string
  readonly architecture: "arm64" | "amd64"
  // Upper bound on the compressed size of one image's layers.
  readonly quotaBytes: number
  readonly client: RegistryClient
}

export interface ImageConfig {
  readonly Cmd?: readonly string[]
  readonly Entrypoint?: readonly string[]
  readonly Env?: readonly string[]
  readonly WorkingDir?: string
}

const canonical = (reference: ImageReference) =>
  `${reference.registry}/${reference.repository}${reference.digest ? `@${reference.digest}` : `:${reference.tag}`}`
const hex = (digest: string) => digest.slice("sha256:".length)

export class ImageStore {
  readonly #options: ImageStoreOptions
  readonly #dirs: { blobs: string; images: string; tags: string }

  constructor(options: ImageStoreOptions) {
    this.#options = options
    this.#dirs = { blobs: path.join(options.state, "blobs"), images: path.join(options.state, "images"), tags: path.join(options.state, "tags.json") }
    for (const dir of [this.#dirs.blobs, this.#dirs.images]) fs.mkdirSync(dir, { recursive: true })
  }

  #tags(): Record<string, string> {
    return fs.existsSync(this.#dirs.tags) ? (JSON.parse(fs.readFileSync(this.#dirs.tags, "utf8")) as Record<string, string>) : {}
  }

  #saveTags(tags: Record<string, string>) {
    const temporary = `${this.#dirs.tags}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(tags))
    fs.renameSync(temporary, this.#dirs.tags)
  }

  images(): { name: string; digest: string }[] {
    return Object.entries(this.#tags()).map(([name, digest]) => ({ name, digest }))
  }

  rootfs(digest: string): string {
    return path.join(this.#dirs.images, hex(digest), "rootfs")
  }

  config(digest: string): ImageConfig {
    const file = path.join(this.#dirs.images, hex(digest), "config.json")
    return ((JSON.parse(fs.readFileSync(file, "utf8")) as { config?: ImageConfig }).config ?? {})
  }

  // A cached blob is verified again on every use: the cache is app data, not a trust root.
  async #blob(reference: ImageReference, descriptor: Descriptor): Promise<Uint8Array> {
    const file = path.join(this.#dirs.blobs, hex(descriptor.digest))
    if (fs.existsSync(file)) {
      const cached = new Uint8Array(fs.readFileSync(file))
      verifyBlob(cached, descriptor.digest, descriptor.size)
      return cached
    }
    const bytes = await this.#options.client.blob(reference, descriptor)
    fs.writeFileSync(`${file}.part`, bytes)
    fs.renameSync(`${file}.part`, file)
    return bytes
  }

  async pull(name: string): Promise<{ digest: string; rootfs: string }> {
    const reference = parseReference(name)
    const release = acquireLock(this.#options.state)
    try {
      const { digest, manifest } = await this.#options.client.manifest(reference, this.#options.architecture)
      const total = manifest.layers.reduce((sum, layer) => sum + layer.size, 0)
      if (total > this.#options.quotaBytes) throw new OciError(`image layers are ${total} bytes, over the ${this.#options.quotaBytes}-byte quota`)
      if (!fs.existsSync(this.rootfs(digest))) await this.#unpack(reference, digest, manifest.config, manifest.layers)
      this.#saveTags({ ...this.#tags(), [canonical(reference)]: digest })
      return { digest, rootfs: this.rootfs(digest) }
    } finally {
      release()
    }
  }

  async #unpack(reference: ImageReference, digest: string, config: Descriptor, layers: readonly (Descriptor & { compression: "gzip" | "none" })[]) {
    const staging = fs.mkdtempSync(path.join(this.#dirs.images, ".staging-"))
    try {
      fs.mkdirSync(path.join(staging, "rootfs"))
      fs.writeFileSync(path.join(staging, "config.json"), await this.#blob(reference, config))
      fs.writeFileSync(path.join(staging, "blobs.json"), JSON.stringify([config, ...layers].map((blob) => blob.digest)))
      for (const layer of layers) {
        const bytes = await this.#blob(reference, layer)
        applyLayer(readTar(layer.compression === "gzip" ? new Uint8Array(gunzipSync(bytes)) : bytes), path.join(staging, "rootfs"))
      }
      fs.renameSync(staging, path.join(this.#dirs.images, hex(digest)))
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true })
      throw error
    }
  }

  remove(name: string) {
    const tags = this.#tags()
    const key = canonical(parseReference(name))
    const digest = tags[key]
    if (!digest) throw new OciError(`no image tagged ${key}`)
    delete tags[key]
    this.#saveTags(tags)
    if (Object.values(tags).includes(digest)) return
    fs.rmSync(path.join(this.#dirs.images, hex(digest)), { recursive: true, force: true })
    this.#collectBlobs(new Set(Object.values(tags)))
  }

  // Blobs are kept only while an image still uses them (its blobs.json lists them).
  #collectBlobs(live: Set<string>) {
    const used = new Set<string>()
    for (const digest of live) {
      const listing = path.join(this.#dirs.images, hex(digest), "blobs.json")
      if (fs.existsSync(listing)) for (const blob of JSON.parse(fs.readFileSync(listing, "utf8")) as string[]) used.add(hex(blob))
    }
    for (const file of fs.readdirSync(this.#dirs.blobs)) if (!used.has(file)) fs.rmSync(path.join(this.#dirs.blobs, file), { force: true })
  }
}
