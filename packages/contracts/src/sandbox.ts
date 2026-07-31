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
