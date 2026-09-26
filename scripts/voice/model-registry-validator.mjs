import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const REQUIRED_STRING_FIELDS = [
  "provider",
  "model_id",
  "version",
  "upstream_revision",
  "licence",
  "architecture",
  "quantization",
  "minimum_runtime",
]

export function validateVoiceModelRegistry(registry) {
  const errors = []
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    return ["registry root must be an object"]
  }
  if (!Array.isArray(registry.models) || registry.models.length === 0) {
    errors.push("models must be a non-empty array")
    return errors
  }

  const modelIds = new Set()
  for (const [index, model] of registry.models.entries()) {
    const prefix = `models[${index}]`
    if (!model || typeof model !== "object" || Array.isArray(model)) {
      errors.push(`${prefix} must be an object`)
      continue
    }
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof model[field] !== "string" || model[field].trim() === "") {
        errors.push(`${prefix}.${field} must be a non-empty string`)
      }
    }
    if (!/^[a-f0-9]{64}$/.test(model.sha256 ?? "")) {
      errors.push(`${prefix}.sha256 must be a lowercase SHA-256 digest`)
    }
    if (!Number.isSafeInteger(model.size_bytes) || model.size_bytes <= 0) {
      errors.push(`${prefix}.size_bytes must be a positive safe integer`)
    }
    if (!Array.isArray(model.languages) || model.languages.length === 0 || model.languages.some((language) => typeof language !== "string")) {
      errors.push(`${prefix}.languages must be a non-empty string array`)
    }
    if (typeof model.redistributable !== "boolean") {
      errors.push(`${prefix}.redistributable must be a boolean`)
    }
    if (typeof model.source !== "string" || !model.source.startsWith("https://")) {
      errors.push(`${prefix}.source must use HTTPS`)
    }
    if (!model.compatibility || typeof model.compatibility !== "object" || Array.isArray(model.compatibility)) {
      errors.push(`${prefix}.compatibility must be an object`)
    } else if (model.compatibility.file_sha256 !== undefined) {
      const fileDigests = model.compatibility.file_sha256
      if (!fileDigests || typeof fileDigests !== "object" || Array.isArray(fileDigests)
        || Object.values(fileDigests).some((digest) => !/^[a-f0-9]{64}$/.test(digest ?? ""))) {
        errors.push(`${prefix}.compatibility.file_sha256 must map files to lowercase SHA-256 digests`)
      }
    }
    if (typeof model.provider === "string" && typeof model.model_id === "string") {
      const key = `${model.provider}:${model.model_id}`
      if (modelIds.has(key)) errors.push(`${prefix} duplicates ${key}`)
      modelIds.add(key)
    }
  }

  return errors
}

export function verifyModelArtifactBytes(bytes, expectedSha256) {
  if (!(bytes instanceof Uint8Array) || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? "")) return false
  const actualSha256 = createHash("sha256").update(bytes).digest("hex")
  return actualSha256 === expectedSha256
}

async function main() {
  const registryPath = process.argv[2] ?? "packages/voice-host/models/registry.json"
  let registry
  try {
    registry = JSON.parse(await readFile(registryPath, "utf8"))
  } catch (error) {
    console.error(`Cannot read model registry ${registryPath}: ${error.message}`)
    process.exitCode = 1
    return
  }
  const errors = validateVoiceModelRegistry(registry)
  if (errors.length) {
    console.error(`Invalid voice model registry ${registryPath}:`)
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }
  console.log(`Voice model registry metadata valid: ${registry.models.length} entries`)
  if (registry.missing_for_adoption?.length) {
    console.warn(`Model/runtime adoption evidence remains incomplete: ${registry.missing_for_adoption.length} required group(s) lack adoption evidence`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
