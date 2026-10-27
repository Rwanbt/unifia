/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { NetworkAuthority } from "@unifia/network-authority"
import { createHash } from "node:crypto"
import { parseReference } from "../../src/container/oci"
import { authorizedFetch, type Fetch, RegistryClient } from "../../src/container/registry"

const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

// A registry that follows the Docker Hub protocol: bearer challenge, image
// index, platform manifest, and blobs redirected to a CDN origin.
function hub(options: { tamperManifest?: boolean; redirectLoop?: boolean } = {}) {
  const layer = new TextEncoder().encode("layer-bytes")
  const config = json({ architecture: "arm64" })
  const manifest = json({
    schemaVersion: 2,
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: sha(config), size: config.length },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: sha(layer), size: layer.length }],
  })
  const index = json({
    manifests: [{ mediaType: "application/vnd.oci.image.manifest.v1+json", digest: sha(manifest), size: manifest.length, platform: { os: "linux", architecture: "arm64" } }],
  })
  const seen: { url: string; authorization?: string }[] = []
  const base = "https://registry-1.docker.io/v2/library/alpine"
  const fetchImpl: Fetch = async (url, init) => {
    seen.push({ url, authorization: init.headers.authorization })
    if (url.startsWith("https://auth.docker.io/token")) return Response.json({ token: "t0k" })
    if (url.startsWith("https://production.cloudflare.docker.com/")) return new Response(layer)
    if (init.headers.authorization !== "Bearer t0k") {
      return new Response("", { status: 401, headers: { "www-authenticate": 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull"' } })
    }
    if (url === `${base}/manifests/3.21`) return new Response(index, { headers: { "docker-content-digest": sha(index) } })
    if (url === `${base}/manifests/${sha(manifest)}`) return new Response(options.tamperManifest ? json({ evil: true }) : manifest)
    if (url === `${base}/blobs/${sha(layer)}`) {
      const location = options.redirectLoop ? url : `https://production.cloudflare.docker.com/blob?sig=1`
      return new Response("", { status: 307, headers: { location } })
    }
    return new Response("", { status: 404 })
  }
  return { fetchImpl, seen, layer, manifest }
}

test("a tag resolves through the bearer challenge and the index to the arm64 manifest", async () => {
  const { fetchImpl, manifest } = hub()
  const result = await new RegistryClient(fetchImpl).manifest(parseReference("alpine:3.21"), "arm64")
  expect(result.digest).toBe(sha(manifest))
  expect(result.manifest.layers[0]!.compression).toBe("gzip")
})

test("blobs follow the CDN redirect, verified, and the token never leaves the registry", async () => {
  const { fetchImpl, seen, layer } = hub()
  const client = new RegistryClient(fetchImpl)
  const { manifest } = await client.manifest(parseReference("alpine:3.21"), "arm64")
  expect(await client.blob(parseReference("alpine:3.21"), manifest.layers[0]!)).toEqual(layer)
  const cdn = seen.find((request) => request.url.startsWith("https://production.cloudflare.docker.com/"))
  expect(cdn).toBeDefined()
  expect(cdn!.authorization).toBeUndefined()
})

test("a manifest that does not match its digest is refused", async () => {
  await expect(new RegistryClient(hub({ tamperManifest: true }).fetchImpl).manifest(parseReference("alpine:3.21"), "arm64")).rejects.toThrow(/size|digest/)
})

test("redirect loops stop", async () => {
  const { fetchImpl } = hub({ redirectLoop: true })
  const client = new RegistryClient(fetchImpl)
  const { manifest } = await client.manifest(parseReference("alpine:3.21"), "arm64")
  await expect(client.blob(parseReference("alpine:3.21"), manifest.layers[0]!)).rejects.toThrow(/redirects/)
})

test("the authorized fetch refuses registries outside the allowlist and private addresses", async () => {
  const publicDns = authorizedFetch(new NetworkAuthority(async () => ["104.16.1.1"]))
  await expect(publicDns("https://evil.example/v2/", { headers: {}, redirect: "manual" })).rejects.toThrow(/not allowlisted/)
  const privateDns = authorizedFetch(new NetworkAuthority(async () => ["192.168.1.10"]))
  await expect(privateDns("https://ghcr.io/v2/", { headers: {}, redirect: "manual" })).rejects.toThrow(/non-public/)
})
