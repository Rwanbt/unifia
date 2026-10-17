/* SPDX-License-Identifier: MIT */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { NativeRestrictedDriver } from "../../sandbox-drivers/src/index.ts"
import { SandboxBroker, type SandboxDriver, type SandboxPolicy } from "../src/sandbox.ts"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-sandbox-auto-"))
afterAll(async () => { await rm(root, { recursive: true, force: true }) })
const policy = (backend: SandboxPolicy["backend"] = "auto", network: SandboxPolicy["network"] = "none"): SandboxPolicy =>
  ({ backend, network, filesystem: { readOnly: true }, resources: { timeoutMs: 5000 } })

function claimedDocker(features = ["network-none", "readonly-policy"], available = true) {
  let prepares = 0
  const driver: SandboxDriver = {
    backend: "docker",
    inspect: async () => [{ backend: "docker", available, features }],
    prepare: async (p) => { prepares++; return { id: "docker-probe", backend: "docker", createdAt: 1, policy: p } },
    execute: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 }),
    terminate: async () => {},
  }
  return { driver, prepared: () => prepares }
}

describe("sandbox broker isolation eligibility (#571)", () => {
  test("real native driver can write host filesystem despite declaring readonly: auto must refuse it", async () => {
    const driver = new NativeRestrictedDriver()
    const marker = path.join(root, "native-wrote-host.txt")
    const uncontained = await driver.prepare(policy("native"))
    const actual = await driver.execute(uncontained, {
      command: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "host-write")`],
    })
    expect(actual.exitCode).toBe(0)
    expect(await readFile(marker, "utf8")).toBe("host-write")
    await driver.terminate(uncontained)
    const broker = new SandboxBroker([driver])
    await expect(broker.prepare(policy())).rejects.toThrow(/isolation|backend/)
    await expect(broker.prepare(policy("native"))).rejects.toThrow(/isolation|backend/)
  })

  test("auto skips an available native backend and chooses declared Docker network-none enforcement", async () => {
    const docker = claimedDocker()
    const native = new NativeRestrictedDriver()
    const broker = new SandboxBroker([native, docker.driver])
    const handle = await broker.prepare(policy())
    expect(handle.backend).toBe("docker")
    expect(handle.policy.network).toBe("none")
    expect(handle.policy.filesystem.readOnly).toBe(true)
    expect(docker.prepared()).toBe(1)
  })

  test("no eligible Docker: refuse instead of falling back to WSL/native or trusting missing features", async () => {
    const native = new NativeRestrictedDriver()
    const noNetwork = claimedDocker(["readonly-policy"])
    const unavailable = claimedDocker(undefined, false)
    await expect(new SandboxBroker([native, noNetwork.driver]).prepare(policy())).rejects.toThrow()
    expect(noNetwork.prepared()).toBe(0)
    await expect(new SandboxBroker([native, unavailable.driver]).prepare(policy())).rejects.toThrow()
    expect(unavailable.prepared()).toBe(0)
    await expect(new SandboxBroker([noNetwork.driver]).prepare(policy("docker"))).rejects.toThrow()
  })

  test("open and limited egress are refused before any driver receives a prepared policy", async () => {
    const docker = claimedDocker()
    const broker = new SandboxBroker([docker.driver])
    await expect(broker.prepare(policy("auto", "limited"))).rejects.toThrow()
    await expect(broker.prepare(policy("docker", "open"))).rejects.toThrow()
    expect(docker.prepared()).toBe(0)
  })

  test("a caller cannot redirect an approved Docker handle into an unisolated native driver", async () => {
    let unsafeEffects = 0
    const native: SandboxDriver = {
      backend: "native",
      inspect: async () => [{ backend: "native", available: true, features: [] }],
      prepare: async (p) => ({ id: "native", backend: "native", createdAt: 1, policy: p }),
      execute: async () => { unsafeEffects++; return { exitCode: 0, stdout: "", stderr: "", durationMs: 0 } },
      terminate: async () => {},
    }
    const docker = claimedDocker()
    const broker = new SandboxBroker([native, docker.driver])
    const handle = await broker.prepare(policy())
    expect(handle.backend).toBe("docker")
    await expect(broker.execute({ ...handle, backend: "native" }, { command: "unsafe", args: [] })).rejects.toThrow()
    expect(unsafeEffects).toBe(0)
    await broker.terminate(handle)
  })

  test("mutating a returned handle cannot loosen the policy used for execution", async () => {
    let observed: SandboxPolicy | undefined
    const docker: SandboxDriver = {
      backend: "docker",
      inspect: async () => [{ backend: "docker", available: true, features: ["network-none", "readonly-policy"] }],
      prepare: async (p) => ({ id: "pinned-docker", backend: "docker", createdAt: 1, policy: p }),
      execute: async (handle) => {
        observed = handle.policy
        return { exitCode: 0, stdout: "safe", stderr: "", durationMs: 0 }
      },
      terminate: async () => {},
    }
    const broker = new SandboxBroker([docker])
    const handle = await broker.prepare(policy())
    handle.policy.network = "open"
    handle.policy.filesystem.readOnly = false
    expect((await broker.execute(handle, { command: "noop", args: [] })).stdout).toBe("safe")
    expect(observed?.network).toBe("none")
    expect(observed?.filesystem.readOnly).toBe(true)
    await broker.terminate(handle)
  })

  test("duplicate driver IDs and replay of a terminated handle cannot acquire a new lease", async () => {
    const docker = claimedDocker()
    const broker = new SandboxBroker([docker.driver])
    const original = await broker.prepare(policy())
    await expect(broker.prepare(policy())).rejects.toThrow(/reused|duplicate/)
    await broker.terminate(original)
    const replacement = await broker.prepare(policy())
    expect(replacement.id).not.toBe(original.id)
    await expect(broker.execute(original, { command: "noop", args: [] })).rejects.toThrow()
    await broker.terminate(replacement)
  })

  test("mount paths and cwd cannot be accepted when the Docker driver does not apply them", async () => {
    const docker = claimedDocker()
    const broker = new SandboxBroker([docker.driver], ["C:\\workspace"])
    await expect(broker.prepare({
      ...policy(),
      filesystem: { readOnly: true, paths: ["C:\\workspace\\..\\outside"] },
    })).rejects.toThrow()
    await expect(broker.prepare({
      ...policy(),
      filesystem: { readOnly: true, paths: ["C:\\workspace\\project"] },
    })).rejects.toThrow()
    const handle = await broker.prepare(policy())
    await expect(broker.execute(handle, { command: "noop", args: [], cwd: "C:\\workspace\\..\\outside" })).rejects.toThrow()
    await broker.terminate(handle)
  })
})
