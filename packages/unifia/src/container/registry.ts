/* SPDX-License-Identifier: MIT */
// Pulls manifests and blobs from OCI registries (ADR-098). Every hop,
// redirects included, is authorized by the Network Authority (ADR-023 §112);
// a bearer token is never sent to an origin other than the registry's.
import { parseBrowserEgressPolicy } from "@unifia/contracts"
import type { NetworkAuthority } from "@unifia/network-authority"
import { networkAuthorityFor } from "../util/network-authority"
import { type Descriptor, type ImageManifest, type ImageReference, OciError, parseImageManifest, selectPlatform, verifyBlob } from "./oci"

export type Fetch = (url: string, init: { headers: Record<string, string>; redirect: "manual" }) => Promise<Response>

// Docker Hub redirects blobs to one of several CDNs depending on region (CloudFront
// was observed on 2026-10-22; Cloudflare and R2 are in Docker's firewall list);
// GHCR redirects to githubusercontent. Exact origins only, no wildcard.
export const REGISTRY_ORIGINS = [
  "https://registry-1.docker.io",
  "https://auth.docker.io",
  "https://production.cloudfront.docker.com",
  "https://production.cloudflare.docker.com",
  "https://docker-images-prod.6aa30f8b08e16409b46e0173d6de2f56.r2.cloudflarestorage.com",
  "https://ghcr.io",
  "https://pkg-containers.githubusercontent.com",
]
const MAX_REDIRECTS = 5
const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ")

// On Android the authority resolves through c-ares: musl's getaddrinfo cannot (#869).
export function authorizedFetch(authority: NetworkAuthority = networkAuthorityFor()): Fetch {
  const policy = parseBrowserEgressPolicy({ allowedOrigins: REGISTRY_ORIGINS, defaultDeny: true })
  return async (url, init) => fetch((await authority.authorizeBrowserUrl(url, policy)).url, init)
}

function challenge(header: string | null): URL | undefined {
  const params = Object.fromEntries([...(header ?? "").matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key!, value!]))
  if (!header?.startsWith("Bearer ") || !params.realm) return undefined
  const url = new URL(params.realm)
  for (const key of ["service", "scope"]) if (params[key]) url.searchParams.set(key, params[key])
  return url
}

export class RegistryClient {
  readonly #fetch: Fetch
  readonly #tokens = new Map<string, string>()

  constructor(fetchImpl: Fetch = authorizedFetch()) {
    this.#fetch = fetchImpl
  }

  // Follows redirects by hand so each new origin is authorized and loses the token.
  async #get(reference: ImageReference, path: string, accept?: string): Promise<Response> {
    const origin = `https://${reference.registry}`
    let url = `${origin}/v2/${reference.repository}/${path}`
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const token = this.#tokens.get(reference.repository)
      const sameOrigin = new URL(url).origin === origin
      const headers: Record<string, string> = { ...(accept ? { accept } : {}), ...(token && sameOrigin ? { authorization: `Bearer ${token}` } : {}) }
      const response = await this.#fetch(url, { headers, redirect: "manual" })
      if (response.status === 401 && sameOrigin && !token) {
        const realm = challenge(response.headers.get("www-authenticate"))
        if (!realm) throw new OciError(`${url}: unauthorized without a bearer challenge`)
        const issued = await this.#fetch(realm.href, { headers: {}, redirect: "manual" })
        if (!issued.ok) throw new OciError(`token request failed: HTTP ${issued.status}`)
        const body = (await issued.json()) as { token?: string; access_token?: string }
        const value = body.token ?? body.access_token
        if (!value) throw new OciError("token response carries no token")
        this.#tokens.set(reference.repository, value)
        hop--
        continue
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        if (!location) throw new OciError(`${url}: redirect without a location`)
        url = new URL(location, url).href
        continue
      }
      if (!response.ok) throw new OciError(`${url}: HTTP ${response.status}`)
      return response
    }
    throw new OciError(`${url}: more than ${MAX_REDIRECTS} redirects`)
  }

  // Returns the platform manifest and its digest; a tag is resolved to that digest once.
  async manifest(reference: ImageReference, architecture: string): Promise<{ digest: string; manifest: ImageManifest }> {
    const top = await this.#get(reference, `manifests/${reference.digest ?? reference.tag}`, MANIFEST_TYPES)
    let body = new Uint8Array(await top.arrayBuffer())
    let digest = top.headers.get("docker-content-digest") ?? reference.digest
    let parsed = JSON.parse(new TextDecoder().decode(body)) as { manifests?: unknown }
    if (reference.digest) verifyBlob(body, reference.digest, body.length)
    if (parsed.manifests) {
      const chosen = selectPlatform(parsed, architecture)
      const platform = await this.#get(reference, `manifests/${chosen.digest}`, MANIFEST_TYPES)
      body = new Uint8Array(await platform.arrayBuffer())
      verifyBlob(body, chosen.digest, chosen.size)
      digest = chosen.digest
      parsed = JSON.parse(new TextDecoder().decode(body))
    }
    if (!digest) throw new OciError("registry gave no digest for the manifest")
    verifyBlob(body, digest, body.length)
    return { digest, manifest: parseImageManifest(parsed) }
  }

  async blob(reference: ImageReference, descriptor: Descriptor): Promise<Uint8Array> {
    const bytes = new Uint8Array(await (await this.#get(reference, `blobs/${descriptor.digest}`)).arrayBuffer())
    verifyBlob(bytes, descriptor.digest, descriptor.size)
    return bytes
  }
}
