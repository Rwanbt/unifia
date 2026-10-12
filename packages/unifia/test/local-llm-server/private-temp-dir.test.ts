/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ensurePrivateDirectory } from "../../src/local-llm-server/private-temp-dir"

test("ensurePrivateDirectory creates a private directory", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "unifia-llm-private-"))
  const directory = path.join(parent, "runtime")
  try {
    ensurePrivateDirectory(directory)
    expect(fs.lstatSync(directory).isDirectory()).toBe(true)
    if (process.platform !== "win32") {
      fs.chmodSync(directory, 0o755)
      ensurePrivateDirectory(directory)
      expect(fs.statSync(directory).mode & 0o077).toBe(0)
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test.skipIf(process.platform === "win32")("ensurePrivateDirectory rejects a symbolic link", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "unifia-llm-link-"))
  const target = path.join(parent, "target")
  const link = path.join(parent, "runtime")
  try {
    fs.mkdirSync(target)
    fs.symlinkSync(target, link, "dir")
    expect(() => ensurePrivateDirectory(link)).toThrow("Unsafe local LLM runtime directory")
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test("ensurePrivateDirectory rejects a regular file", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "unifia-llm-invalid-"))
  const file = path.join(parent, "runtime")
  try {
    fs.writeFileSync(file, "occupied")
    expect(() => ensurePrivateDirectory(file)).toThrow("Unsafe local LLM runtime directory")
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})
