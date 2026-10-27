/* SPDX-License-Identifier: MIT */
// A registry speaking the real OCI distribution protocol, served from memory:
// the store runs its whole pull path (manifest, digests, layers) against it.
import { createHash } from "node:crypto"
import type { Fetch } from "../../src/container/registry"
import { type FixtureEntry, gzip, tar } from "../toolchain/tar-fixture"

const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

export function fakeRegistry(layers: FixtureEntry[][], config: object = { config: { Cmd: ["/bin/sh"], Env: ["PATH=/usr/bin:/bin"] } }) {
  const blobs = new Map<string, Uint8Array>()
  const configBytes = json({ architecture: "arm64", os: "linux", ...config })
  blobs.set(sha(configBytes), configBytes)
  const layerDescriptors = layers.map((entries) => {
    const bytes = gzip(tar(entries))
    blobs.set(sha(bytes), bytes)
    return { mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: sha(bytes), size: bytes.length }
  })
  const manifest = json({
    schemaVersion: 2,
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: sha(configBytes), size: configBytes.length },
    layers: layerDescriptors,
  })
  const requests: string[] = []
  const fetchImpl: Fetch = async (url) => {
    requests.push(url)
    const [, kind, reference] = url.match(/\/v2\/library\/demo\/(manifests|blobs)\/(.+)$/) ?? []
    if (kind === "manifests") return new Response(manifest, { headers: { "docker-content-digest": sha(manifest) } })
    const blob = kind === "blobs" ? blobs.get(reference!) : undefined
    return blob ? new Response(new Uint8Array(blob)) : new Response("", { status: 404 })
  }
  return { fetchImpl, requests, blobs, manifestDigest: sha(manifest), layerDigests: layerDescriptors.map((layer) => layer.digest) }
}
