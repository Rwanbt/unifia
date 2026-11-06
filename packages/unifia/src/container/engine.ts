/* SPDX-License-Identifier: MIT */
// The image store and the runtime, wired once for the CLI and the HTTP routes (ADR-098).
import { containerLocation, DEFAULT_CONTAINER_QUOTA_BYTES } from "./defaults"
import { RegistryClient } from "./registry"
import { ContainerRuntime } from "./runtime"
import { ImageStore } from "./store"

export interface ContainerEngine {
  readonly store: ImageStore
  readonly runtime: ContainerRuntime
}

export interface ContainerEngineOverrides {
  readonly state?: string
  readonly proot?: string
}

export function openContainerEngine(dataDir: string, overrides: ContainerEngineOverrides = {}): ContainerEngine {
  const location = containerLocation(dataDir)
  const state = overrides.state ?? location.state
  const store = new ImageStore({ state, architecture: location.architecture, quotaBytes: DEFAULT_CONTAINER_QUOTA_BYTES, client: new RegistryClient() })
  const runtime = new ContainerRuntime({ state, store, proot: overrides.proot ?? location.proot, loader: location.loader })
  return { store, runtime }
}
