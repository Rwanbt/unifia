/* SPDX-License-Identifier: MIT */
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { RegistryClient } from "../../src/container/registry"
import { ImageStore } from "../../src/container/store"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { fakeRegistry } from "./registry-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))

const LAYERS = [
  [{ name: "etc/os-release", data: "demo 1" }, { name: "usr/bin/tool", data: "v1", mode: 0o755 }, { name: "tmp/junk", data: "j" }],
  [{ name: "usr/bin/tool", data: "v2", mode: 0o755 }, { name: "tmp/.wh.junk" }],
]

function setup(registry = fakeRegistry(LAYERS), quotaBytes = 10_000_000) {
  const state = fixtureDirSync("unifia-images-")
  created.push(state)
  return { store: new ImageStore({ state, architecture: "arm64", quotaBytes, client: new RegistryClient(registry.fetchImpl) }), registry, state }
}

test("pull builds the image rootfs from its verified layers and records the tag", async () => {
  const { store, registry } = setup()
  const image = await store.pull("demo:1")
  expect(image.digest).toBe(registry.manifestDigest)
  expect(fs.readFileSync(path.join(image.rootfs, "usr/bin/tool"), "utf8")).toBe("v2")
  expect(fs.existsSync(path.join(image.rootfs, "tmp/junk"))).toBe(false)
  expect(store.images()).toEqual([{ name: "registry-1.docker.io/library/demo:1", digest: registry.manifestDigest }])
  expect(store.config(image.digest).Cmd).toEqual(["/bin/sh"])
})

test("a second pull of the same digest downloads no blob again", async () => {
  const { store, registry } = setup()
  await store.pull("demo:1")
  const before = registry.requests.filter((url) => url.includes("/blobs/")).length
  await store.pull("demo:1")
  expect(registry.requests.filter((url) => url.includes("/blobs/")).length).toBe(before)
})

test("a tampered layer leaves no image, no tag and no cached blob", async () => {
  const registry = fakeRegistry(LAYERS)
  const bytes = registry.blobs.get(registry.layerDigests[1]!)!
  registry.blobs.set(registry.layerDigests[1]!, bytes.map((byte, index) => (index === bytes.length - 3 ? byte ^ 0xff : byte)))
  const { store, state } = setup(registry)
  await expect(store.pull("demo:1")).rejects.toThrow(/digest/)
  expect(store.images()).toEqual([])
  expect(fs.readdirSync(path.join(state, "images"))).toEqual([])
  expect(fs.existsSync(path.join(state, "blobs", registry.layerDigests[1]!.slice(7)))).toBe(false)
})

test("an image over the quota is refused before any blob is downloaded", async () => {
  const { store, registry } = setup(fakeRegistry(LAYERS), 10)
  await expect(store.pull("demo:1")).rejects.toThrow(/quota/)
  expect(registry.requests.some((url) => url.includes("/blobs/"))).toBe(false)
})

test("removing the last tag deletes the rootfs and the blobs nothing else uses", async () => {
  const { store, state } = setup()
  const image = await store.pull("demo:1")
  store.remove("demo:1")
  expect(store.images()).toEqual([])
  expect(fs.existsSync(image.rootfs)).toBe(false)
  expect(fs.readdirSync(path.join(state, "blobs"))).toEqual([])
})
