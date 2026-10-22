/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import path from "node:path"
import { containerLocation } from "../../src/container/defaults"

test("on Android PRoot and its loader come from nativeLibraryDir", () => {
  const nativeLibraryDir = path.join("data", "app", "ai.unifia-1", "lib", "arm64")
  const location = containerLocation("/data/files", { OPENCODE_MOBILE_MUSL_LINKER: path.join(nativeLibraryDir, "libmusl_linker.so") }, "arm64")
  expect(location).toEqual({
    state: path.join("/data/files", "containers"),
    architecture: "arm64",
    proot: path.join(nativeLibraryDir, "libproot.so"),
    loader: path.join(nativeLibraryDir, "libproot-loader.so"),
  })
})

test("elsewhere UNIFIA_PROOT names PRoot and the host architecture picks images", () => {
  expect(containerLocation("/d", { UNIFIA_PROOT: "/opt/proot" }, "x64")).toMatchObject({ proot: "/opt/proot", architecture: "amd64" })
  const plain = containerLocation("/d", {}, "arm64")
  expect(plain).toMatchObject({ proot: "proot", architecture: "arm64" })
  expect(plain.loader).toBeUndefined()
})
