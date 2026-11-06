/* SPDX-License-Identifier: MIT */
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { RegistryClient } from "../../src/container/registry"
import { ContainerRuntime, containerCommand, containerEnvironment, prootArguments } from "../../src/container/runtime"
import { ImageStore } from "../../src/container/store"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { fakeRegistry } from "./registry-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))

test("the command follows Docker's Entrypoint and Cmd rule", () => {
  expect(containerCommand({ Cmd: ["python3"] })).toEqual(["python3"])
  expect(containerCommand({ Entrypoint: ["docker-entrypoint.sh"], Cmd: ["node"] }, ["node", "-v"])).toEqual(["docker-entrypoint.sh", "node", "-v"])
  expect(() => containerCommand({})).toThrow(/no command/)
})

test("the environment layers image ENV and caller overrides over defaults", () => {
  const env = containerEnvironment({ Env: ["PATH=/opt/bin", "LANG=C.UTF-8"] }, ["LANG=fr_FR.UTF-8", "EMPTY="])
  expect(env).toMatchObject({ PATH: "/opt/bin", LANG: "fr_FR.UTF-8", EMPTY: "", HOME: "/root" })
})

test("PRoot gets the container root, emulated root, the host /dev /proc /sys and the workdir", () => {
  expect(prootArguments("/c/rootfs", "/app", ["sh", "-c", "id"])).toEqual([
    "-0", "-r", "/c/rootfs", "-b", "/dev", "-b", "/proc", "-b", "/sys", "-w", "/app", "--kill-on-exit", "sh", "-c", "id",
  ])
})

// The real PRoot run is the arm64 e2e (script/container-e2e.sh); here a shell
// stands in for it so the record, the copy and the exit code are checked.
test.skipIf(process.platform === "win32")("run copies the image, records the container and its exit code", async () => {
  const state = fixtureDirSync("unifia-containers-")
  created.push(state)
  const store = new ImageStore({ state, architecture: "arm64", quotaBytes: 1e7, client: new RegistryClient(fakeRegistry([[{ name: "etc/os-release", data: "demo" }]]).fetchImpl) })
  await store.pull("demo:1")
  const fakeProot = path.join(state, "fake-proot")
  fs.writeFileSync(fakeProot, '#!/bin/sh\nwhile [ "$1" != "--kill-on-exit" ]; do [ "$1" = "-r" ] && root="$2"; shift; done\ncat "$root/etc/os-release"; exit 3\n', { mode: 0o755 })
  const runtime = new ContainerRuntime({ state, store, proot: fakeProot })
  let output = ""
  const record = await runtime.run("demo:1", { command: ["true"], name: "first" }, (chunk) => (output += chunk))
  expect(output).toBe("demo")
  expect(record.exitCode).toBe(3)
  expect(runtime.list().map((entry) => entry.name)).toEqual(["first"])
  expect(fs.readFileSync(path.join(state, "containers", record.id, "rootfs/etc/resolv.conf"), "utf8")).toContain("nameserver")
  await expect(runtime.run("demo:1", { command: ["true"], name: "first" })).rejects.toThrow(/taken/)
  runtime.remove("first")
  expect(runtime.list()).toEqual([])
})
