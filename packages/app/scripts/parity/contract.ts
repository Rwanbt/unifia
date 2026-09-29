// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:contract — validates every policy/snapshot/lock against its JSON
// schema and reports the diff. This is the G1 schema gate referenced by the
// consolidated plan §55 and §87. Schemas live in parity/schemas/.

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { PARITY_DIR, SCHEMAS_DIR, readJson, hashFile, hashCanonical } from "./shared"

type JsonSchema = {
  type?: string | string[]
  required?: string[]
  properties?: Record<string, JsonSchema | true>
  additionalProperties?: boolean | JsonSchema
  enum?: unknown[]
  const?: unknown
  pattern?: string
  format?: string
  minLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  items?: JsonSchema | true
  $ref?: string
}

type ValidationError = { path: string; message: string }

function parseSchema(content: string): JsonSchema {
  return JSON.parse(content) as JsonSchema
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema | null {
  if (!ref.startsWith("#/")) return null
  const parts = ref.slice(2).split("/")
  let node: unknown = root
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p]
    } else {
      return null
    }
  }
  return node as JsonSchema
}

function validate(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  errors: ValidationError[],
): void {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root)
    if (!resolved) {
      errors.push({ path, message: `unresolved $ref ${schema.$ref}` })
      return
    }
    validate(value, resolved, root, path, errors)
    return
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}` })
    return
  }
  if (schema.enum && !schema.enum.includes(value as never)) {
    errors.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}` })
    return
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value
    if (actual === "number") {
      const integerOk = !types.includes("integer") || Number.isInteger(value)
      const numberOk = types.includes("number") || types.includes("integer")
      if (!numberOk || !integerOk) {
        errors.push({ path, message: `expected type ${types.join("|")}, got ${actual}` })
        return
      }
    } else if (!types.includes(actual as never)) {
      errors.push({ path, message: `expected type ${types.join("|")}, got ${actual}` })
      return
    }
  }
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    errors.push({ path, message: `value ${JSON.stringify(value)} does not match ${schema.pattern}` })
    return
  }
  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength) {
    errors.push({ path, message: `string shorter than minLength ${schema.minLength}` })
    return
  }
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) {
    errors.push({ path, message: `value ${value} below minimum ${schema.minimum}` })
    return
  }
  if (schema.maximum !== undefined && typeof value === "number" && value > schema.maximum) {
    errors.push({ path, message: `value ${value} above maximum ${schema.maximum}` })
    return
  }
  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems) {
    errors.push({ path, message: `array shorter than minItems ${schema.minItems}` })
    return
  }
  if (schema.maxItems !== undefined && Array.isArray(value) && value.length > schema.maxItems) {
    errors.push({ path, message: `array longer than maxItems ${schema.maxItems}` })
    return
  }
  if (schema.required && value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required) {
      if (!(key in (value as Record<string, unknown>))) {
        errors.push({ path, message: `missing required property ${key}` })
      }
    }
  }
  if (schema.properties && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in obj) validate(obj[key], sub as JsonSchema, root, `${path}/${key}`, errors)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          errors.push({ path, message: `unexpected property ${key}` })
        }
      }
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((item, i) => validate(item, schema.items as JsonSchema, root, `${path}/${i}`, errors))
  }
}

type Pair = { schema: string; data: string; schemaFile: string; dataFile: string }
const pairs: Pair[] = [
  { schema: "environment-lock.schema.json", data: "environment-lock.json" },
  { schema: "baseline.schema.json", data: "baseline.json" },
  { schema: "probe-policy.schema.json", data: "probe-policy.json" },
  { schema: "mutation-spec.schema.json", data: "mutation-spec.json" },
  { schema: "path-classification.schema.json", data: "path-classification.json" },
  { schema: "census-merge-policy.schema.json", data: "census-merge-policy.json" },
  { schema: "generated-paths-policy.schema.json", data: "generated-paths-policy.json" },
  { schema: "g0-derivation-policy.schema.json", data: "g0-derivation-policy.json" },
  { schema: "design-ownership.schema.json", data: "design-ownership.json" },
  { schema: "reference-locale-capabilities.schema.json", data: "reference-locale-capabilities.json" },
  { schema: "path-classification-coverage.schema.json", data: "path-classification-coverage.json" },
  { schema: "branch-policy-snapshot.schema.json", data: "branch-policy-snapshot.json" },
  { schema: "execution-budget.schema.json", data: "execution-budget.json" },
].map((p) => ({ ...p, schemaFile: join(SCHEMAS_DIR, p.schema), dataFile: join(PARITY_DIR, p.data) }))

const counters = { schemaErrors: 0, filesChecked: 0, missingData: 0, missingSchema: 0 }
const details: string[] = []
const policyHashes: Record<string, string> = {}
const schemaHashes: Record<string, string> = {}

for (const pair of pairs) {
  let schema: JsonSchema
  let data: unknown
  try {
    schema = parseSchema(readFileSync(pair.schemaFile, "utf8"))
    schemaHashes[pair.schema] = hashFile(pair.schemaFile)
  } catch {
    counters.missingSchema += 1
    details.push(`MISSING_SCHEMA: ${pair.schema}`)
    continue
  }
  try {
    data = readJson(pair.dataFile)
    policyHashes[pair.data] = hashCanonical(data)
  } catch {
    counters.missingData += 1
    details.push(`MISSING_DATA: ${pair.data}`)
    continue
  }
  const errs: ValidationError[] = []
  validate(data, schema, schema, "#", errs)
  if (errs.length === 0) {
    counters.filesChecked += 1
    details.push(`OK: ${pair.data}`)
    continue
  }
  counters.schemaErrors += errs.length
  counters.filesChecked += 1
  for (const e of errs) details.push(`SCHEMA: ${pair.data} ${e.path} — ${e.message}`)
}

const status =
  counters.schemaErrors === 0 && counters.missingSchema === 0 && counters.missingData === 0
    ? "PASS"
    : "FAIL"

process.stdout.write(
  JSON.stringify(
    {
      status,
      counters,
      details,
      policyHashes,
      schemaHashes,
    },
    null,
    2,
  ) + "\n",
)
process.exit(status === "PASS" ? 0 : 1)