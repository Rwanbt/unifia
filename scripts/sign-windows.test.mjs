/* SPDX-License-Identifier: MIT */
// Run with: node --test scripts/sign-windows.test.mjs
// Tauri runs the script with Windows PowerShell 5.1 (`signCommand` in tauri.conf.json), so the
// tests use the same interpreter. signCommand exists only on Windows, so the suite is skipped elsewhere.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "script", "sign-windows.ps1")
const SIGN_ENV_KEYS = [
  "GITHUB_ACTIONS",
  "UNIFIA_WINDOWS_SIGNING",
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
  "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
  "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE",
]

function fileToSign() {
  const file = join(mkdtempSync(join(tmpdir(), "sign-windows-")), "app.exe")
  writeFileSync(file, "")
  return file
}

/** Runs the script the way Tauri does, with only the signing variables given by the case. */
function runSign(extraEnv, paths = [fileToSign()]) {
  const env = { ...process.env }
  for (const key of SIGN_ENV_KEYS) delete env[key]
  Object.assign(env, extraEnv)
  return spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...paths], {
    env,
    encoding: "utf8",
  })
}

const skip = process.platform === "win32" ? false : "signCommand runs only on Windows"

test("optional mode: a skip outside GitHub Actions exits 0 and says the binary stays unsigned", { skip }, () => {
  const result = runSign({})
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr + result.stdout, /Windows signing skipped, the binaries stay unsigned: not running on GitHub Actions/)
})

test("optional mode: a skip on Actions without Azure configuration exits 0 with a GitHub warning annotation", { skip }, () => {
  const result = runSign({ GITHUB_ACTIONS: "true" })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /::warning title=Windows signing skipped::.*Azure Artifact Signing is not configured/)
})

test("required mode: a skip outside GitHub Actions fails the build", { skip }, () => {
  const result = runSign({ UNIFIA_WINDOWS_SIGNING: "required" })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Windows signing is required but was skipped: not running on GitHub Actions/)
})

test("required mode: missing Azure configuration on Actions fails the build", { skip }, () => {
  const result = runSign({ UNIFIA_WINDOWS_SIGNING: "required", GITHUB_ACTIONS: "true" })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Windows signing is required but was skipped: Azure Artifact Signing is not configured/)
})

test("an unknown signing mode is refused, not read as optional", { skip }, () => {
  const result = runSign({ UNIFIA_WINDOWS_SIGNING: "maybe" })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /UNIFIA_WINDOWS_SIGNING must be 'optional' or 'required', got 'maybe'/)
})

test("no path to sign is refused before any signing decision", { skip }, () => {
  const result = runSign({}, [])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /At least one path is required/)
})
