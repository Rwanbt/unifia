/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { SandboxBroker, assertSandboxDriverConformance, type SandboxDriver } from "../src/sandbox.ts"
const calls: string[] = []
const driver: SandboxDriver = {
  backend: "docker",
  inspect: async () => [{ backend: "docker", available: true, features: ["readonly-policy", "network-none"] }],
  prepare: async (policy) => ({ id: "sb-1", backend: "docker", createdAt: 1, policy }),
  execute: async (_handle, request) => { calls.push(request.command); return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 1 } },
  terminate: async () => { calls.push("terminate") },
}
const broker = new SandboxBroker([driver], ["c:\\workspace"])
const handle = await broker.prepare({ backend: "auto", network: "none", filesystem: { readOnly: false, paths: [] }, resources: {} })
assert.equal(handle.policy.filesystem.readOnly, true)
assert.equal((await broker.execute(handle, { command: "echo", args: [] })).stdout, "ok")
let rejected = false
try { await broker.prepare({ backend: "docker", network: "open", filesystem: { readOnly: true, paths: [] }, resources: {} }) } catch { rejected = true }
assert.equal(rejected, true)
await broker.terminate(handle)
assert.deepEqual(calls, ["echo", "terminate"])
console.log("SandboxBroker: 4/4 passed")

const conformanceDriver: SandboxDriver = { backend: "native", inspect: async () => [{ backend: "native", available: true, features: ["readonly"] }], prepare: async (policy) => ({ id: "conformance", backend: "native", createdAt: 1, policy }), execute: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 }), terminate: async () => {} }
const conformance = await assertSandboxDriverConformance(conformanceDriver, () => 2)
if (conformance.checks.length !== 4) throw new Error("sandbox conformance incomplete")
console.log("SandboxConformance: 4/4 passed")
