/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { OciError, parseImageManifest, parseReference, selectPlatform, verifyBlob } from "../../src/container/oci"

test("parseReference fills Docker Hub defaults the way the docker CLI does", () => {
  expect(parseReference("alpine")).toEqual({ registry: "registry-1.docker.io", repository: "library/alpine", tag: "latest" })
  expect(parseReference("python:3.12-alpine")).toMatchObject({ repository: "library/python", tag: "3.12-alpine" })
  expect(parseReference("bitnami/redis:7")).toMatchObject({ registry: "registry-1.docker.io", repository: "bitnami/redis", tag: "7" })
  expect(parseReference("docker.io/library/node:22")).toMatchObject({ registry: "registry-1.docker.io", repository: "library/node" })
  expect(parseReference("ghcr.io/owner/app:v1")).toEqual({ registry: "ghcr.io", repository: "owner/app", tag: "v1" })
  expect(parseReference("localhost:5000/app")).toMatchObject({ registry: "localhost:5000", repository: "app", tag: "latest" })
  const digest = `sha256:${"a".repeat(64)}`
  expect(parseReference(`alpine@${digest}`)).toEqual({ registry: "registry-1.docker.io", repository: "library/alpine", digest })
})

test("parseReference refuses malformed names and digests", () => {
  for (const bad of ["", "UPPER/case", "alpine@sha256:short", "alpine@md5:abc", "a/../b", "alpine:bad tag"]) {
    expect(() => parseReference(bad)).toThrow(OciError)
  }
})

const index = {
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [
    { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: `sha256:${"1".repeat(64)}`, size: 1, platform: { os: "linux", architecture: "amd64" } },
    { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: `sha256:${"2".repeat(64)}`, size: 1, platform: { os: "linux", architecture: "arm64", variant: "v8" } },
    { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: `sha256:${"3".repeat(64)}`, size: 1, platform: { os: "unknown", architecture: "unknown" } },
  ],
}

test("selectPlatform picks the manifest for the device architecture", () => {
  expect(selectPlatform(index, "arm64").digest).toBe(`sha256:${"2".repeat(64)}`)
  expect(selectPlatform(index, "amd64").digest).toBe(`sha256:${"1".repeat(64)}`)
  expect(() => selectPlatform(index, "riscv64")).toThrow(/no linux\/riscv64/)
})

test("parseImageManifest accepts gzip and plain tar layers and refuses the rest", () => {
  const layer = (mediaType: string) => ({ mediaType, digest: `sha256:${"4".repeat(64)}`, size: 10 })
  const manifest = (layers: object[]) => ({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: `sha256:${"5".repeat(64)}`, size: 2 },
    layers,
  })
  const parsed = parseImageManifest(manifest([layer("application/vnd.docker.image.rootfs.diff.tar.gzip"), layer("application/vnd.oci.image.layer.v1.tar")]))
  expect(parsed.layers.map((entry) => entry.compression)).toEqual(["gzip", "none"])
  expect(() => parseImageManifest(manifest([layer("application/vnd.oci.image.layer.v1.tar+zstd")]))).toThrow(/zstd/)
  expect(() => parseImageManifest({ ...manifest([]), layers: [{ mediaType: "x", digest: "sha256:zz", size: 1 }] })).toThrow(OciError)
})

test("verifyBlob accepts the exact bytes of a digest and nothing else", () => {
  const bytes = new TextEncoder().encode("layer")
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  expect(() => verifyBlob(bytes, digest, bytes.length)).not.toThrow()
  expect(() => verifyBlob(new TextEncoder().encode("layeR"), digest, 5)).toThrow(/digest/)
  expect(() => verifyBlob(bytes, digest, 6)).toThrow(/size/)
})
