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
  readonly #allowedPaths: readonly string[]
  readonly #active = new Set<SandboxId>()
  constructor(drivers: readonly SandboxDriver[], allowedPaths: readonly string[] = []) {
    this.#drivers = new Map(drivers.map((driver) => [driver.backend, driver]))
    this.#allowedPaths = allowedPaths.map((value) => value.replace(/[\\/]+$/, "").toLowerCase())
  }
  async inspect(): Promise<SandboxBackendInfo[]> {
    const result: SandboxBackendInfo[] = []
    for (const driver of this.#drivers.values()) result.push(...await driver.inspect())
    return result
  }
  async prepare(policy: SandboxPolicy): Promise<SandboxHandle> {
    const selected: Exclude<SandboxBackend, "auto"> = policy.backend === "auto" ? await this.#selectBackend() : policy.backend
    const driver = this.#drivers.get(selected)
    if (!driver) throw new Error("sandbox backend is unavailable")
    if (policy.network === "open") throw new Error("sandbox network must be explicitly brokered")
    const paths = policy.filesystem.paths ?? []
    for (const path of paths) if (!this.#isAllowedPath(path)) throw new Error("sandbox mount is outside the allowlist")
    const safePolicy: SandboxPolicy = { ...policy, backend: selected, network: policy.network ?? "none", filesystem: { ...policy.filesystem, readOnly: true, paths } }
    const handle = await driver.prepare(safePolicy)
    this.#active.add(handle.id)
    return { ...handle, backend: selected, policy: safePolicy }
  }
  async execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution> {
    if (!this.#active.has(handle.id)) throw new Error("sandbox handle is not active")
    if (handle.backend === "auto") throw new Error("sandbox handle backend is unresolved")
    const driver = this.#drivers.get(handle.backend)
    if (!driver) throw new Error("sandbox backend is unavailable")
    if (request.cwd && handle.policy.filesystem.paths?.length && !this.#isAllowedPath(request.cwd)) throw new Error("sandbox cwd is outside the allowlist")
    return driver.execute(handle, { ...request, env: request.env ? { ...request.env } : undefined })
  }
  async terminate(handle: SandboxHandle): Promise<void> {
    if (!this.#active.delete(handle.id)) return
    if (handle.backend === "auto") throw new Error("sandbox handle backend is unresolved")
    const driver = this.#drivers.get(handle.backend)
    if (driver) await driver.terminate(handle)
  }
  async #selectBackend(): Promise<Exclude<SandboxBackend, "auto">> {
    for (const backend of ["native", "docker", "wsl2", "lima"] as const) {
      const driver = this.#drivers.get(backend)
      if (!driver) continue
      const available = (await driver.inspect()).some((info) => info.backend === backend && info.available)
      if (available) return backend
    }
    throw new Error("no sandbox backend is available")
  }
  #isAllowedPath(value: string): boolean {
    const normalized = value.replace(/[\\/]+$/, "").toLowerCase()
    return this.#allowedPaths.some((root) => normalized === root || normalized.startsWith(`${root}\\`) || normalized.startsWith(`${root}/`))
  }
}
