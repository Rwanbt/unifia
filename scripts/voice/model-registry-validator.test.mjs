import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { validateVoiceModelRegistry, verifyModelArtifactBytes } from "./model-registry-validator.mjs"

const validModel = {
  provider: "fixture-provider",
  model_id: "fixture-model",
  version: "1.0.0",
  upstream_revision: "fixture-provider/fixture-model@0123456789abcdef",
  sha256: "a".repeat(64),
  size_bytes: 3,
  licence: "MIT",
  languages: ["en"],
  architecture: "fixture",
  quantization: "fp32",
  redistributable: true,
  source: "https://example.invalid/model",
  minimum_runtime: "fixture-runtime>=1.0.0",
  compatibility: {},
}

function run(name, check) {
  check()
  console.log(`PASS ${name}`)
}

const registry = JSON.parse(await readFile("packages/voice-host/models/registry.json", "utf8"))
run("accepts checked-in registry metadata", () => assert.deepEqual(validateVoiceModelRegistry(registry), []))
run("rejects malformed digest and missing metadata", () => {
  const errors = validateVoiceModelRegistry({ models: [{ ...validModel, sha256: "not-a-digest", licence: "" }] })
  assert.ok(errors.some((error) => error.includes("sha256")))
  assert.ok(errors.some((error) => error.includes("licence")))
})
run("rejects malformed pinned file digests", () => {
  const errors = validateVoiceModelRegistry({
    models: [{ ...validModel, compatibility: { file_sha256: { "model.onnx": "not-a-digest" } } }],
  })
  assert.ok(errors.some((error) => error.includes("file_sha256")))
})
run("rejects duplicate provider/model identities", () => {
  assert.ok(validateVoiceModelRegistry({ models: [validModel, validModel] }).some((error) => error.includes("duplicates")))
})
run("detects artifact SHA-256 mismatches", () => {
  const artifact = new TextEncoder().encode("voice-model")
  const sha256 = createHash("sha256").update(artifact).digest("hex")
  assert.equal(verifyModelArtifactBytes(artifact, sha256), true)
  assert.equal(verifyModelArtifactBytes(new TextEncoder().encode("corrupt"), sha256), false)
  assert.equal(verifyModelArtifactBytes(artifact, "bad"), false)
})
