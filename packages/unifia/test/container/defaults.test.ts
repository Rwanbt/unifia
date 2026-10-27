/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import path from "node:path"
import { splitRunArguments } from "../../src/cli/cmd/container"
import { containerLocation } from "../../src/container/defaults"

test("everything after the image belongs to the container command, as with docker run", () => {
  const argv = ["bun", "index.ts", "container", "run", "--name", "n1", "-e", "A=1", "node:22", "node", "-e", "console.log(1)", "--name", "x"]
  expect(splitRunArguments(argv)).toEqual({ image: "node:22", command: ["node", "-e", "console.log(1)", "--name", "x"] })
  expect(splitRunArguments(["container", "run", "--state=/s", "alpine", "sh", "-c", "id"])).toEqual({ image: "alpine", command: ["sh", "-c", "id"] })
  expect(() => splitRunArguments(["container", "run", "--name", "only"])).toThrow(/image/)
})

test("on Android PRoot and its loader come from nativeLibraryDir", () => {
  const nativeLibraryDir = path.join("data", "app", "ai.unifia-1", "lib", "arm64")
  const location = containerLocation("/data/files", { OPENCODE_MOBILE_MUSL_LINKER: path.join(nativeLibraryDir, "libmusl_linker.so") }, "arm64")
  expect(location).toEqual({
    state: path.join("/data/files", "containers"),
    architecture: "arm64",
    proot: path.join(nativeLibraryDir, "libproot_exec.so"),
    loader: path.join(nativeLibraryDir, "libproot-loader.so"),
  })
})

test("elsewhere UNIFIA_PROOT names PRoot and the host architecture picks images", () => {
  expect(containerLocation("/d", { UNIFIA_PROOT: "/opt/proot" }, "x64")).toMatchObject({ proot: "/opt/proot", architecture: "amd64" })
  const plain = containerLocation("/d", {}, "arm64")
  expect(plain).toMatchObject({ proot: "proot", architecture: "arm64" })
  expect(plain.loader).toBeUndefined()
})
