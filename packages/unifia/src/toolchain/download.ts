/* SPDX-License-Identifier: MIT */
// Network side of the toolchain manager. Every request goes through the
// Network Authority (ADR-023): the origin must be the Alpine CDN and the
// name must resolve to public addresses; redirects are refused so the
// destination cannot change after it was authorized.
import { parseBrowserEgressPolicy } from "@unifia/contracts"
import { NetworkAuthority } from "@unifia/network-authority"
import path from "node:path"
import { ALPINE_KEYS } from "./repository"
import type { ToolchainManagerOptions } from "./manager"

export const ALPINE_ORIGIN = "https://dl-cdn.alpinelinux.org"
export const ALPINE_BRANCH = "v3.21"
export const DEFAULT_REPOSITORIES = ["main", "community"].map((section) => `${ALPINE_ORIGIN}/alpine/${ALPINE_BRANCH}/${section}`)
export const DEFAULT_QUOTA_BYTES = 4 * 1024 ** 3
// The largest Alpine v3.21 aarch64 package (llvm19-libs) is ~40 MB; this caps a hostile stream.
const MAX_DOWNLOAD_BYTES = 512 * 1024 ** 2

export function authorizedFetchBytes(authority = new NetworkAuthority()): (url: string) => Promise<Uint8Array> {
  const policy = parseBrowserEgressPolicy({ allowedOrigins: [ALPINE_ORIGIN], defaultDeny: true })
  return async (url) => {
    const destination = await authority.authorizeBrowserUrl(url, policy)
    const response = await fetch(destination.url, { redirect: "error" })
    if (!response.ok || !response.body) throw new Error(`GET ${url}: HTTP ${response.status}`)
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      received += chunk.value.length
      if (received > MAX_DOWNLOAD_BYTES) {
        await reader.cancel()
        throw new Error(`GET ${url}: larger than ${MAX_DOWNLOAD_BYTES} bytes`)
      }
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks)
  }
}

export type ToolchainArch = ToolchainManagerOptions["arch"]

export const hostArch = (): ToolchainArch => (process.arch === "arm64" ? "aarch64" : "x86_64")

// On Android the rootfs is the one the native runtime extracted and wraps
// (packages/mobile/src-tauri/src/runtime.rs); elsewhere a private directory.
export function defaultLocation(dataDir: string, env: NodeJS.ProcessEnv = process.env): { root: string; state: string } {
  const mobileRoot = env.OPENCODE_MOBILE_ROOTFS_DIR
  if (mobileRoot) return { root: mobileRoot, state: path.join(path.dirname(mobileRoot), "toolchains") }
  return { root: path.join(dataDir, "toolchains", "rootfs"), state: path.join(dataDir, "toolchains", "state") }
}

export function defaultOptions(dataDir: string, arch: ToolchainArch = hostArch()): ToolchainManagerOptions {
  return {
    ...defaultLocation(dataDir),
    arch,
    repositories: DEFAULT_REPOSITORIES,
    keys: [ALPINE_KEYS[arch]],
    quotaBytes: DEFAULT_QUOTA_BYTES,
    fetchBytes: authorizedFetchBytes(),
  }
}
