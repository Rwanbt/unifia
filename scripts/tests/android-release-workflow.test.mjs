// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const workflow = readFileSync(fileURLToPath(new URL("../../.github/workflows/release.yml", import.meta.url)), "utf8")
const keys = [
  "UNIFIA_ANDROID_KEYSTORE_B64",
  "UNIFIA_ANDROID_KEY_ALIAS",
  "UNIFIA_ANDROID_KEYSTORE_PASSWORD",
  "UNIFIA_ANDROID_KEY_PASSWORD",
]

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`)
  assert.notEqual(start, -1, `missing workflow step: ${name}`)
  const end = workflow.indexOf("\n      - ", start + 1)
  return workflow.slice(start, end === -1 ? undefined : end)
}

test("dry-run Android signing has an isolated ephemeral key and no release credentials", () => {
  const dry = step("Sign APK (dry-run key)")
  assert.match(dry, /if: inputs\.dry_run/)
  assert.match(dry, /keytool -genkeypair/)
  assert.match(dry, /CN=Unifia CI/)
  assert.match(dry, /verify --verbose/)
  for (const key of keys) assert.doesNotMatch(dry, new RegExp(key))
})

test("every release requires all real signing credentials and refuses a CI fallback", () => {
  const real = step("Sign APK (required release key)")
  assert.match(real, /if: \$\{\{ !inputs\.dry_run \}\}/)
  const guard = real.match(/for name in ([^\n]+); do\n\s*if \[ -z "\$\{!name:-\}" \]/)
  assert.ok(guard, "the release signing step must reject unset signing variables")
  for (const key of keys) {
    assert.match(real, new RegExp(`secrets\\.${key}`))
    assert.ok(guard[1].split(/\s+/).includes(key), `unguarded signing configuration: ${key}`)
  }
  assert.match(real, /base64 --decode/)
  assert.match(real, /--ks-pass env:UNIFIA_ANDROID_KEYSTORE_PASSWORD/)
  assert.match(real, /--key-pass env:UNIFIA_ANDROID_KEY_PASSWORD/)
  assert.match(real, /verify --verbose/)
  assert.doesNotMatch(real, /keytool|unifia-ci|pass:android/)
})

test("the publication-bound APK is checked against an explicit certificate allowlist", () => {
  const check = step("Verify APK release certificate")
  const upload = workflow.slice(workflow.indexOf("      - name: Verify APK release certificate"))
  assert.match(check, /if: \$\{\{ !inputs\.dry_run \}\}/)
  assert.match(check, /vars\.UNIFIA_ANDROID_CERT_SHA256/)
  assert.match(check, /Get-ExpectedCertificateSha256/)
  assert.match(check, /Assert-ApkCertificateAllowed/)
  assert.match(check, /verify --print-certs/)
  assert.match(upload, /name: apk/)
  assert.match(upload, /if-no-files-found: error/)
  assert.match(workflow, /needs: \[build-cli, build-tauri, build-android, sbom, publish-gate\]/)
})
