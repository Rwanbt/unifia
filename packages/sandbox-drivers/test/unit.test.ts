/* SPDX-License-Identifier: MIT */
// Hermetic policy tests only. Live WSL, Docker and process deadlines stay in
// drivers.integration.ts; they are not certified by a green unit job.
import { describe, expect, test } from "bun:test"
import { SandboxBroker, type SandboxPolicy } from "@unifia/contracts"
import { DockerDriver, NativeRestrictedDriver, SandboxPolicyError } from "../src/index.js"

const policy = (over: Partial<SandboxPolicy> = {}): SandboxPolicy => ({
  backend: "native",
  network: "none",
  filesystem: { readOnly: true },
  resources: { cpu: 1, memoryMb: 128, timeoutMs: 5_000 },
  ...over,
})

describe("sandbox policy validation (no host processes)", () => {
  test("rejects open and unenforceable limited egress before execution", async () => {
    const native = new NativeRestrictedDriver()
    await expect(native.prepare(policy({ network: "open" }))).rejects.toBeInstanceOf(SandboxPolicyError)
    await expect(native.prepare(policy({ network: "limited" }))).rejects.toBeInstanceOf(SandboxPolicyError)
    const docker = new DockerDriver("alpine:3.21")
    await expect(docker.prepare(policy({ backend: "docker", network: "limited" }))).rejects.toBeInstanceOf(SandboxPolicyError)
  })

  test("refuses invalid resource bounds", async () => {
    const native = new NativeRestrictedDriver()
    for (const resources of [{ timeoutMs: 0 }, { timeoutMs: 5_000, cpu: 0 }, { timeoutMs: 5_000, memoryMb: -1 }]) {
      await expect(native.prepare(policy({ resources }))).rejects.toBeInstanceOf(SandboxPolicyError)
    }
  })

  test("forces native read-only and rejects unprepared handles", async () => {
    const native = new NativeRestrictedDriver()
    const handle = await native.prepare(policy({ filesystem: { readOnly: false } }))
    expect(handle.policy.filesystem.readOnly).toBe(true)
    await expect(native.execute({ ...handle, id: "unknown" }, { command: "true", args: [] })).rejects.toBeInstanceOf(SandboxPolicyError)
    await native.terminate(handle)
  })

  test("requires an explicit Docker image", () => {
    expect(() => new DockerDriver("")).toThrow(SandboxPolicyError)
    expect(new DockerDriver("alpine:3.21").backend).toBe("docker")
  })

  test("broker never silently falls back to native", async () => {
    const broker = new SandboxBroker([new NativeRestrictedDriver()], ["c:\\workspace"])
    await expect(broker.prepare(policy({ backend: "auto" }))).rejects.toThrow()
    await expect(broker.prepare(policy({ backend: "docker" }))).rejects.toThrow()
    await expect(new SandboxBroker([]).prepare(policy({ backend: "auto" }))).rejects.toThrow()
  })
})
