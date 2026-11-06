/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { NetworkAuthority } from "@unifia/network-authority"
import path from "node:path"
import { authorizedFetchBytes, defaultLocation } from "../../src/toolchain/download"

test("downloads are refused for any origin other than the Alpine CDN", async () => {
  const fetchBytes = authorizedFetchBytes(new NetworkAuthority(async () => ["151.101.2.132"]))
  await expect(fetchBytes("https://evil.example/alpine/v3.21/main/aarch64/APKINDEX.tar.gz")).rejects.toThrow(/not allowlisted/)
  await expect(fetchBytes("http://dl-cdn.alpinelinux.org/alpine/v3.21/main/aarch64/APKINDEX.tar.gz")).rejects.toThrow()
})

test("downloads are refused when the CDN name resolves to a private address", async () => {
  const fetchBytes = authorizedFetchBytes(new NetworkAuthority(async () => ["10.0.0.7"]))
  await expect(fetchBytes("https://dl-cdn.alpinelinux.org/alpine/v3.21/main/aarch64/APKINDEX.tar.gz")).rejects.toThrow(/non-public/)
})

test("on Android the manager targets the rootfs the native runtime extracted", () => {
  const rootfs = path.join("data", "files", "rootfs")
  expect(defaultLocation("/unused", { OPENCODE_MOBILE_ROOTFS_DIR: rootfs })).toEqual({
    root: rootfs,
    state: path.join("data", "files", "toolchains"),
  })
  expect(defaultLocation("/home/u/.local/share/unifia", {}).root).toBe(path.join("/home/u/.local/share/unifia", "toolchains", "rootfs"))
})
