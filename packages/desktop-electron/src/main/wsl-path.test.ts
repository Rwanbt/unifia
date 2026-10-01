// SPDX-License-Identifier: MIT

import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { convertWslPath } from "./wsl-path"

describe("WSL path conversion", () => {
  test("home suffix remains literal data in a real shell", () => {
    const suffix = '/folder "quoted"\\$(printf INJECTED)`printf INJECTED` $HOME'
    const result = convertWslPath(`~${suffix}`, "windows", (file, args) => {
      expect(file).toBe("wsl")
      expect(args.slice(0, 3)).toEqual(["-e", "sh", "-lc"])
      // Exercise the production command with a harmless printf witness in place of wslpath.
      const command = args[3].replace("exec wslpath", "printf '%s\\n'")
      return execFileSync(process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh", [
        "-c", command, ...args.slice(4),
      ], { env: { ...process.env, HOME: "/home/fixture" } })
    })
    expect(result.split("\n")).toEqual(["-w", `/home/fixture${suffix}`])
  })

  test("ordinary paths are passed directly and output is trimmed", () => {
    const path = 'C:\\folder with spaces\\$HOME "quoted"'
    expect(convertWslPath(path, "linux", (file, args) => {
      expect(file).toBe("wsl")
      expect(args).toEqual(["-e", "wslpath", "-u", path])
      return Buffer.from("  /mnt/c/folder\n")
    })).toBe("/mnt/c/folder")
  })

  test("bare home and default direction retain their meaning", () => {
    convertWslPath("~", null, (_file, args) => {
      expect(args.slice(4)).toEqual(["sh", "-u", ""])
      return Buffer.from("/home/fixture")
    })
  })

  test("conversion failures remain explicit", () => {
    expect(() => convertWslPath("~", "windows", () => {
      throw new Error("conversion unavailable")
    })).toThrow("Failed to run wslpath: Error: conversion unavailable")
  })
})
