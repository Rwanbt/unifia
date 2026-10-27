/* SPDX-License-Identifier: MIT */
// Where containers live and which PRoot runs them (ADR-098).
import path from "node:path"

export const DEFAULT_CONTAINER_QUOTA_BYTES = 8 * 1024 ** 3

export interface ContainerLocation {
  readonly state: string
  readonly proot: string
  readonly loader?: string
  readonly architecture: "arm64" | "amd64"
}

// On Android PRoot and its loader ship in nativeLibraryDir, the directory the
// runtime already exports through libmusl_linker.so; elsewhere UNIFIA_PROOT names it.
export function containerLocation(dataDir: string, env: NodeJS.ProcessEnv = process.env, arch = process.arch): ContainerLocation {
  const architecture = arch === "arm64" ? "arm64" : "amd64"
  const state = path.join(dataDir, "containers")
  const linker = env.OPENCODE_MOBILE_MUSL_LINKER
  if (linker) {
    const nativeLibraryDir = path.dirname(linker)
    return { state, architecture, proot: path.join(nativeLibraryDir, "libproot_exec.so"), loader: path.join(nativeLibraryDir, "libproot-loader.so") }
  }
  return { state, architecture, proot: env.UNIFIA_PROOT ?? "proot" }
}
