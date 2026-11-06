/* SPDX-License-Identifier: MIT */
// Container error paths the coverage audit found unexercised (2026-10-22).
import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { OciError, parseReference, selectPlatform } from "../../src/container/oci"
import { type Fetch, RegistryClient } from "../../src/container/registry"
import { ContainerRuntime } from "../../src/container/runtime"
import { ImageStore } from "../../src/container/store"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { fakeRegistry } from "./registry-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))
const tempDir = () => created[created.push(fixtureDirSync("unifia-ctr-errors-")) - 1]!
const alpine = parseReference("alpine:3.21")
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`

test("an index that is not an OCI index is refused", () => {
  expect(() => selectPlatform({ manifests: "nope" }, "arm64")).toThrow(/invalid image index/)
})

function client(responses: (url: string, headers: Record<string, string>) => Response) {
  return new RegistryClient((async (url, init) => responses(url, init.headers)) as Fetch)
}

test("registry failures are reported, never retried into a success", async () => {
  await expect(client(() => new Response("", { status: 401 })).manifest(alpine, "arm64")).rejects.toThrow(/without a bearer challenge/)
  const challenge = { "www-authenticate": 'Bearer realm="https://auth.docker.io/token"' }
  const tokenFails = client((url) => (url.startsWith("https://auth") ? new Response("", { status: 503 }) : new Response("", { status: 401, headers: challenge })))
  await expect(tokenFails.manifest(alpine, "arm64")).rejects.toThrow(/token request failed: HTTP 503/)
  const noToken = client((url) => (url.startsWith("https://auth") ? Response.json({}) : new Response("", { status: 401, headers: challenge })))
  await expect(noToken.manifest(alpine, "arm64")).rejects.toThrow(/carries no token/)
  await expect(client(() => new Response("", { status: 307 })).manifest(alpine, "arm64")).rejects.toThrow(/redirect without a location/)
  await expect(client(() => new Response("", { status: 500 })).manifest(alpine, "arm64")).rejects.toThrow(/HTTP 500/)
})

test("a manifest fetched by tag without a digest header is refused", async () => {
  const manifest = json({ config: { mediaType: "c", digest: `sha256:${"1".repeat(64)}`, size: 1 }, layers: [] })
  await expect(client(() => new Response(manifest)).manifest(alpine, "arm64")).rejects.toThrow(/no digest/)
})

test("a manifest pinned by digest is checked against that digest", async () => {
  const manifest = json({ config: { mediaType: "c", digest: `sha256:${"1".repeat(64)}`, size: 1 }, layers: [] })
  const pinned = parseReference(`alpine@${sha(manifest)}`)
  expect((await client(() => new Response(manifest)).manifest(pinned, "arm64")).digest).toBe(sha(manifest))
  const other = parseReference(`alpine@sha256:${"9".repeat(64)}`)
  await expect(client(() => new Response(manifest)).manifest(other, "arm64")).rejects.toThrow(OciError)
})

function store(registry = fakeRegistry([[{ name: "etc/os-release", data: "demo" }]])) {
  const state = tempDir()
  return { state, registry, images: new ImageStore({ state, architecture: "arm64", quotaBytes: 1e7, client: new RegistryClient(registry.fetchImpl) }) }
}

test("a cached blob corrupted on disk is refused on the next pull", async () => {
  const { state, registry, images } = store()
  const { digest } = await images.pull("demo:1")
  fs.rmSync(path.join(state, "images", digest.slice(7)), { recursive: true })
  const blob = path.join(state, "blobs", registry.layerDigests[0]!.slice(7))
  fs.writeFileSync(blob, "tampered")
  await expect(images.pull("demo:1")).rejects.toThrow(/size|digest/)
  expect(fs.existsSync(path.join(state, "images", digest.slice(7)))).toBe(false)
})

test("removing an unknown tag, running an unpulled image or removing an unknown container is refused", async () => {
  const { state, images } = store()
  expect(() => images.remove("demo:404")).toThrow(/no image tagged/)
  const runtime = new ContainerRuntime({ state, store: images, proot: "proot" })
  await expect(runtime.run("never-pulled:1")).rejects.toThrow(/is not pulled/)
  expect(() => runtime.remove("ghost")).toThrow(/no container ghost/)
})

test("a tag still pointing at an image keeps its rootfs when another tag is removed", async () => {
  const { images } = store()
  const { digest, rootfs } = await images.pull("demo:1")
  await images.pull("demo:latest")
  images.remove("demo:1")
  expect(images.images()).toEqual([{ name: "registry-1.docker.io/library/demo:latest", digest }])
  expect(fs.existsSync(rootfs)).toBe(true)
})
