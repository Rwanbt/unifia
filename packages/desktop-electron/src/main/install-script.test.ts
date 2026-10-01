/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { withInstallScript } from "./install-script"

test("InstallScript_ConcurrentCalls_UseDistinctPrivatePaths", async () => {
  const paths: string[] = []
  const run = async (path: string) => {
    paths.push(path)
    expect(await readFile(path, "utf8")).toBe("echo harmless")
    if (process.platform !== "win32") {
      expect((await stat(dirname(path))).mode & 0o777).toBe(0o700)
      expect((await stat(path)).mode & 0o777).toBe(0o700)
    }
    return path
  }
  await Promise.all([withInstallScript("echo harmless", run), withInstallScript("echo harmless", run)])
  expect(paths).toHaveLength(2)
  expect(paths[0]).not.toBe(paths[1])
  for (const path of paths) await expect(access(dirname(path))).rejects.toThrow()
})

test("InstallScript_RunFailure_PropagatesAndCleansDirectory", async () => {
  let directory = ""
  const failure = new Error("spawn failed")
  await expect(withInstallScript("echo harmless", async (path) => {
    directory = dirname(path)
    throw failure
  })).rejects.toBe(failure)
  await expect(access(directory)).rejects.toThrow()
})

test("InstallScript_PredictableLegacyFile_IsNeverTouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "unifia-installer-test-"))
  try {
    const legacy = join(root, "unifia-install.sh")
    await writeFile(legacy, "untrusted legacy bytes")
    await withInstallScript("trusted bytes", async (path) => {
      expect(path).not.toBe(legacy)
      expect(await readFile(path, "utf8")).toBe("trusted bytes")
    }, root)
    expect(await readFile(legacy, "utf8")).toBe("untrusted legacy bytes")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("InstallScript_HarmlessRealShell_ExecutesAndCleans", async () => {
  const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh"
  let path = ""
  const output = await withInstallScript("#!/bin/sh\nprintf '%s' harmless", async (scriptPath) => {
    path = scriptPath
    return execFileSync(shell, [scriptPath], { encoding: "utf8" })
  })
  expect(output).toBe("harmless")
  await expect(access(dirname(path))).rejects.toThrow()
})
