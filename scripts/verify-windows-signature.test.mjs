/* SPDX-License-Identifier: MIT */
// Run with: node --test scripts/verify-windows-signature.test.mjs
// Get-AuthenticodeSignature is Windows-only, and the tests use Windows PowerShell 5.1 as the release steps do.
// A signed binary cannot be made here, so only the unsigned case and the refusals are covered.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "script", "verify-windows-signature.ps1")
const skip = process.platform === "win32" ? false : "Get-AuthenticodeSignature runs only on Windows"

function unsignedFile() {
  const file = join(mkdtempSync(join(tmpdir(), "verify-signature-")), "app.exe")
  writeFileSync(file, "not a signed binary")
  return file
}

function runVerify(extraEnv, paths = [unsignedFile()]) {
  const env = { ...process.env }
  delete env.UNIFIA_WINDOWS_SIGNING
  Object.assign(env, extraEnv)
  return spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...paths], {
    env,
    encoding: "utf8",
  })
}

test("optional mode: an unsigned development build passes, and the run says it is unsigned", { skip }, () => {
  const result = runVerify({})
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout + result.stderr, /unsigned development build/)
  assert.doesNotMatch(result.stdout, /signature valid/)
})

test("required mode: an unsigned binary fails the release", { skip }, () => {
  const result = runVerify({ UNIFIA_WINDOWS_SIGNING: "required" })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Windows signature verification failed/)
  assert.match(result.stderr, /not validly signed/)
})

test("an unknown mode is refused, not read as optional", { skip }, () => {
  const result = runVerify({ UNIFIA_WINDOWS_SIGNING: "maybe" })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /UNIFIA_WINDOWS_SIGNING must be 'optional' or 'required', got 'maybe'/)
})

test("no path to verify is refused", { skip }, () => {
  const result = runVerify({}, [])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /At least one path is required/)
})
