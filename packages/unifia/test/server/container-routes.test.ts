/* SPDX-License-Identifier: MIT */
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { RegistryClient } from "../../src/container/registry"
import { ContainerRuntime } from "../../src/container/runtime"
import { ImageStore } from "../../src/container/store"
import { ContainerRoutes } from "../../src/server/routes/container"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { fakeRegistry } from "../container/registry-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))

// The fake PRoot prints the image's file and exits 3, so the route's exit code and output are checked end to end.
const FAKE_PROOT = '#!/bin/sh\nwhile [ "$1" != "--kill-on-exit" ]; do [ "$1" = "-r" ] && root="$2"; shift; done\ncat "$root/etc/os-release"; exit 3\n'

function app(quotaBytes = 10_000_000) {
  const state = fixtureDirSync("unifia-container-route-")
  created.push(state)
  const store = new ImageStore({
    state,
    architecture: "arm64",
    quotaBytes,
    client: new RegistryClient(fakeRegistry([[{ name: "etc/os-release", data: "demo" }]]).fetchImpl),
  })
  const proot = path.join(state, "fake-proot")
  fs.writeFileSync(proot, FAKE_PROOT, { mode: 0o755 })
  const runtime = new ContainerRuntime({ state, store, proot })
  return ContainerRoutes(() => ({ store, runtime }))
}

const json = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

test("pull records the image and the images route lists it", async () => {
  const routes = app()
  const pulled = await routes.request("/pull", json("POST", { reference: "demo:1" }))
  expect(pulled.status).toBe(200)
  expect(((await pulled.json()) as { digest: string }).digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  const images = (await (await routes.request("/images")).json()) as { name: string }[]
  expect(images.map((image) => image.name)).toEqual(["registry-1.docker.io/library/demo:1"])
})

test("a reference parseReference refuses is a 400 before the store is touched", async () => {
  const routes = app()
  for (const reference of ["", "Demo:1", "demo:bad tag", "demo@sha256:short"]) {
    expect((await routes.request("/pull", json("POST", { reference }))).status).toBe(400)
  }
  expect(await (await routes.request("/images")).json()).toEqual([])
})

test("a store refusal keeps its reason in a 400, not a 500 with a stack", async () => {
  const routes = app(10)
  const refused = await routes.request("/pull", json("POST", { reference: "demo:1" }))
  expect(refused.status).toBe(400)
  expect(((await refused.json()) as { data: { message: string } }).data.message).toMatch(/quota/)
})

test("removing an image tag by reference empties the list", async () => {
  const routes = app()
  await routes.request("/pull", json("POST", { reference: "demo:1" }))
  expect((await routes.request("/image", json("DELETE", { reference: "demo:1" }))).status).toBe(200)
  expect(await (await routes.request("/images")).json()).toEqual([])
  expect((await routes.request("/image", json("DELETE", { reference: "Demo:1" }))).status).toBe(400)
})

test.skipIf(process.platform === "win32")("run executes under PRoot, returns the record and output, and rm removes it", async () => {
  const routes = app()
  await routes.request("/pull", json("POST", { reference: "demo:1" }))
  const ran = await routes.request("/run", json("POST", { image: "demo:1", command: ["true"] }))
  expect(ran.status).toBe(200)
  const body = (await ran.json()) as { container: { id: string; exitCode: number }; output: string }
  expect(body.output).toBe("demo")
  expect(body.container.exitCode).toBe(3)
  expect(((await (await routes.request("/")).json()) as { id: string }[]).map((entry) => entry.id)).toEqual([body.container.id])
  expect((await routes.request(`/${body.container.id}`, { method: "DELETE" })).status).toBe(200)
  expect(await (await routes.request("/")).json()).toEqual([])
})
