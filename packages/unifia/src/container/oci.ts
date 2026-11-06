/* SPDX-License-Identifier: MIT */
// OCI image references, manifests and blob digests (ADR-098). Pure: no
// network and no disk, so every rule here is tested without a registry.
import { createHash } from "node:crypto"
import z from "zod"

export class OciError extends Error {
  override name = "OciError"
}

export interface ImageReference {
  readonly registry: string
  readonly repository: string
  readonly tag?: string
  readonly digest?: string
}

const DOCKER_HUB = "registry-1.docker.io"
const DIGEST = /^sha256:[0-9a-f]{64}$/
const COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/

// Same defaults as the docker CLI: no registry means Docker Hub, and a
// single-component Hub name lives under library/.
export function parseReference(raw: string): ImageReference {
  const [named, digest] = raw.split("@") as [string, string | undefined]
  if (digest !== undefined && !DIGEST.test(digest)) throw new OciError(`invalid digest in "${raw}"`)
  const parts = named.split("/")
  const hasRegistry = parts.length > 1 && /[.:]|^localhost$/.test(parts[0]!)
  const registry = hasRegistry ? parts.shift()! : DOCKER_HUB
  const lastPart = parts.pop() ?? ""
  const colon = lastPart.lastIndexOf(":")
  const tag = colon === -1 ? undefined : lastPart.slice(colon + 1)
  parts.push(colon === -1 ? lastPart : lastPart.slice(0, colon))
  if (tag !== undefined && !TAG.test(tag)) throw new OciError(`invalid tag in "${raw}"`)
  if (parts.some((part) => !COMPONENT.test(part))) throw new OciError(`invalid repository in "${raw}"`)
  const hub = registry === DOCKER_HUB || registry === "docker.io" || registry === "index.docker.io"
  const repository = hub && parts.length === 1 ? `library/${parts[0]}` : parts.join("/")
  const resolved = hub ? DOCKER_HUB : registry
  if (digest) return { registry: resolved, repository, digest }
  return { registry: resolved, repository, tag: tag ?? "latest" }
}

const Descriptor = z.object({ mediaType: z.string(), digest: z.string().regex(DIGEST), size: z.number().int().nonnegative() })
export type Descriptor = z.infer<typeof Descriptor>

const Index = z.object({
  manifests: z.array(Descriptor.extend({ platform: z.object({ os: z.string(), architecture: z.string(), variant: z.string().optional() }).optional() })),
})

export function selectPlatform(index: unknown, architecture: string): Descriptor {
  const parsed = Index.safeParse(index)
  if (!parsed.success) throw new OciError(`invalid image index: ${parsed.error.message}`)
  const match = parsed.data.manifests.find((entry) => entry.platform?.os === "linux" && entry.platform.architecture === architecture)
  if (!match) throw new OciError(`no linux/${architecture} image in this index`)
  return { mediaType: match.mediaType, digest: match.digest, size: match.size }
}

const LAYER_COMPRESSION: Record<string, "gzip" | "none"> = {
  "application/vnd.docker.image.rootfs.diff.tar.gzip": "gzip",
  "application/vnd.oci.image.layer.v1.tar+gzip": "gzip",
  "application/vnd.oci.image.layer.v1.tar": "none",
}

export interface ImageManifest {
  readonly config: Descriptor
  readonly layers: readonly (Descriptor & { readonly compression: "gzip" | "none" })[]
}

const Manifest = z.object({ config: Descriptor, layers: z.array(Descriptor) })

export function parseImageManifest(manifest: unknown): ImageManifest {
  const parsed = Manifest.safeParse(manifest)
  if (!parsed.success) throw new OciError(`invalid image manifest: ${parsed.error.message}`)
  const layers = parsed.data.layers.map((layer) => {
    const compression = LAYER_COMPRESSION[layer.mediaType]
    // zstd layers exist (some recent images); no decoder ships with the runtime yet.
    if (!compression) throw new OciError(`unsupported layer type ${layer.mediaType}${layer.mediaType.includes("zstd") ? " (zstd)" : ""}`)
    return { ...layer, compression }
  })
  return { config: parsed.data.config, layers }
}

export function verifyBlob(bytes: Uint8Array, digest: string, size: number) {
  if (bytes.length !== size) throw new OciError(`blob ${digest}: size ${bytes.length} != ${size}`)
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== digest) throw new OciError(`blob does not match its digest ${digest}`)
}
