/* SPDX-License-Identifier: MIT */
/**
 * SandboxPort — abstraction sur les backends d'isolation (Native, Docker, WSL, Lima)
 *
 * ADR-0005
 * Source : Plan V3 §7.5
 */

export type SandboxId = string
export type SandboxBackend = "native" | "docker" | "wsl2" | "lima" | "auto"

export interface SandboxBackendInfo {
  backend: SandboxBackend
  available: boolean
  version?: string
  features: string[]
}

export interface SandboxPolicy {
  backend: SandboxBackend
  network: "none" | "limited" | "open"
  filesystem: { readOnly: boolean; paths?: string[] }
  resources: { cpu?: number; memoryMb?: number; timeoutMs?: number }
}

export interface SandboxHandle {
  id: SandboxId
  backend: SandboxBackend
  createdAt: number
  policy: SandboxPolicy
}

export interface ExecutionRequest {
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  stdin?: string
}

export interface Execution {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface SandboxPort {
  inspect(): Promise<SandboxBackendInfo[]>
  prepare(policy: SandboxPolicy): Promise<SandboxHandle>
  execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution>
  terminate(handle: SandboxHandle): Promise<void>
}

export type SandboxDriver = SandboxPort & { backend: Exclude<SandboxBackend, "auto"> }

export class SandboxBroker {
  readonly #drivers: ReadonlyMap<Exclude<SandboxBackend, "auto">, SandboxDriver>
  // Pin the selected driver and policy; caller-supplied handles are not authority.
  readonly #active = new Map<SandboxId, SandboxHandle>()
  constructor(drivers: readonly SandboxDriver[], _allowedPaths: readonly string[] = []) {
    this.#drivers = new Map(drivers.map((driver) => [driver.backend, driver]))
  }
  async inspect(): Promise<SandboxBackendInfo[]> {
    const result: SandboxBackendInfo[] = []
    for (const driver of this.#drivers.values()) result.push(...await driver.inspect())
    return result
  }
  async prepare(policy: SandboxPolicy): Promise<SandboxHandle> {
    // Capture the entire request before the first await. Both callers and
    // drivers can mutate nested objects while availability/prepare is pending.
    const requested = structuredClone(policy)
    // A network:none/read-only declaration is a containment requirement, not
    // permission to run a host process with the same strings in its handle.
    // No shipped driver enforces destination-limited egress yet (#766).
    if (requested.network !== "none") throw new Error("sandbox network policy is not enforceable")
    const paths = requested.filesystem.paths ?? []
    // The current Docker driver does not bind-mount policy paths at all.
    // A lexical allowlist (especially with .. or symlinks) cannot certify
    // filesystem scope, so refuse mounts until the driver enforces them.
    if (paths.length) throw new Error("sandbox mounts are not enforced by this driver")
    const selected: Exclude<SandboxBackend, "auto"> = requested.backend === "auto" ? await this.#selectBackend() : requested.backend
    const driver = this.#drivers.get(selected)
    if (!driver) throw new Error("sandbox backend is unavailable")
    if (!(await this.#canIsolate(driver))) throw new Error("sandbox backend cannot enforce network and filesystem isolation")
    const safePolicy: SandboxPolicy = {
      backend: selected,
      network: "none",
      filesystem: { readOnly: true, paths: [] },
      resources: { ...requested.resources },
    }
    // No shared mutable reference crosses into the driver.
    const handle = await driver.prepare(structuredClone(safePolicy))
    const resourceKeys = ["cpu", "memoryMb", "timeoutMs"] as const
    if (
      handle.backend !== selected || !handle.policy?.filesystem || !handle.policy?.resources ||
      handle.policy.network !== "none" || handle.policy.filesystem.readOnly !== true ||
      (handle.policy.filesystem.paths?.length ?? 0) !== 0 ||
      !resourceKeys.every((key) => handle.policy.resources[key] === safePolicy.resources[key])
    ) {
      try { await driver.terminate(handle) } catch { /* Refusal stands even if cleanup fails. */ }
      throw new Error("sandbox backend weakened the isolation policy")
    }
    const pinned: SandboxHandle = { ...handle, backend: selected, policy: safePolicy }
    // Driver IDs are not bearer capabilities: duplicate/recycled IDs would
    // authorize an older handle to operate on a later sandbox. Issue a fresh
    // broker-scoped opaque ID and retain the real driver handle privately.
    if ([...this.#active.values()].some((active) => active.backend === selected && active.id === handle.id)) {
      throw new Error("sandbox driver reused an active handle id")
    }
    const issuedId = crypto.randomUUID()
    this.#active.set(issuedId, structuredClone(pinned))
    return { ...structuredClone(pinned), id: issuedId }
  }
  async execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution> {
    const pinned = this.#active.get(handle.id)
    if (!pinned || handle.backend !== pinned.backend) throw new Error("sandbox handle is not active for this backend")
    const driver = this.#drivers.get(pinned.backend as Exclude<SandboxBackend, "auto">)
    if (!driver) throw new Error("sandbox backend is unavailable")
    // Docker currently does not apply request.cwd as a working directory.
    if (request.cwd !== undefined) throw new Error("sandbox working directory is not enforced")
    return driver.execute(structuredClone(pinned), { ...request, env: request.env ? { ...request.env } : undefined })
  }
  async terminate(handle: SandboxHandle): Promise<void> {
    const pinned = this.#active.get(handle.id)
    if (!pinned || handle.backend !== pinned.backend) return
    this.#active.delete(handle.id)
    const driver = this.#drivers.get(pinned.backend as Exclude<SandboxBackend, "auto">)
    if (driver) await driver.terminate(structuredClone(pinned))
  }
  async #selectBackend(): Promise<Exclude<SandboxBackend, "auto">> {
    // NativeRestrictedDriver and Wsl2Driver spawn host/WSL processes directly:
    // they enforce neither network:none nor read-only mounts. Availability
    // must never silently downgrade this policy to either backend.
    const docker = this.#drivers.get("docker")
    if (docker && await this.#canIsolate(docker)) return "docker"
    throw new Error("no enforceable sandbox backend is available")
  }
  async #canIsolate(driver: SandboxDriver): Promise<boolean> {
    // Only the audited Docker driver has --network none and --read-only.
    // Inspection is an eligibility hint, NOT physical isolation certification.
    if (driver.backend !== "docker") return false
    const info = await driver.inspect()
    return info.some((entry) =>
      entry.backend === "docker" && entry.available &&
      entry.features.includes("network-none") && entry.features.includes("readonly-policy"),
    )
  }
}

export type SandboxConformanceResult = { backend: Exclude<SandboxBackend, "auto">; checks: readonly string[] }
export async function assertSandboxDriverConformance(driver: SandboxDriver, now: () => number = () => Date.now()): Promise<SandboxConformanceResult> {
  const checks: string[] = []
  const info = await driver.inspect()
  if (!info.some((entry) => entry.backend === driver.backend)) throw new Error("sandbox driver inspection omits its backend")
  checks.push("inspect")
  const policy: SandboxPolicy = { backend: driver.backend, network: "none", filesystem: { readOnly: true }, resources: { cpu: 1, memoryMb: 128, timeoutMs: 5_000 } }
  const handle = await driver.prepare(policy)
  if (handle.backend !== driver.backend || !handle.policy.filesystem.readOnly || handle.policy.network !== "none") throw new Error("sandbox driver weakened the safety policy")
  checks.push("prepare-policy")
  const result = await driver.execute(handle, { command: "true", args: [] })
  if (!Number.isInteger(result.exitCode) || result.durationMs < 0 || result.durationMs > policy.resources.timeoutMs!) throw new Error("sandbox driver returned an invalid execution result")
  checks.push("execute-result")
  await driver.terminate(handle)
  checks.push(`terminate@${now()}`)
  return { backend: driver.backend, checks }
}
