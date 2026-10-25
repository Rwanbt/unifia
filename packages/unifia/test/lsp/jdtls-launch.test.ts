/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { jdtlsLaunchArguments } from "../../src/lsp/server-defs-b"

const input = {
  launcherJar: "/jdtls/plugins/org.eclipse.equinox.launcher_1.0.0.jar",
  configFile: "/jdtls/config_linux",
  dataDir: "/tmp/opencode-jdtls-data",
}

describe("JDTLS launch arguments", () => {
  test("system properties and --add-opens come before -jar, so the JVM receives them", () => {
    const args = jdtlsLaunchArguments(input)
    const jarIndex = args.indexOf("-jar")
    expect(jarIndex).toBeGreaterThan(-1)
    for (const option of [
      "-Declipse.application=org.eclipse.jdt.ls.core.id1",
      "-Dlog.level=ALL",
      "--add-modules=ALL-SYSTEM",
    ]) {
      expect(args.indexOf(option)).toBeLessThan(jarIndex)
    }
    expect(args.indexOf("--add-opens")).toBeLessThan(jarIndex)
  })

  test("each --add-opens value is its own token, as the launcher expects", () => {
    const args = jdtlsLaunchArguments(input)
    const addOpens = args.flatMap((arg, index) => (arg === "--add-opens" ? [args[index + 1]] : []))
    expect(addOpens).toEqual(["java.base/java.util=ALL-UNNAMED", "java.base/java.lang=ALL-UNNAMED"])
    expect(args).not.toContain("--add-opens java.base/java.util=ALL-UNNAMED")
  })

  test("the launcher jar follows -jar, then the launcher's own arguments", () => {
    const args = jdtlsLaunchArguments(input)
    const jarIndex = args.indexOf("-jar")
    expect(args.slice(jarIndex)).toEqual([
      "-jar",
      input.launcherJar,
      "-configuration",
      input.configFile,
      "-data",
      input.dataDir,
    ])
  })
})
