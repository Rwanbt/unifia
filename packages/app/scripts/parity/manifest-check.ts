// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// parity:manifest:check — validates every parity-manifest fragment and the
// cross-references that make it meaningful on the host:
//
//   1. schema shape: required fields, enums, counts, mask shape
//   2. cross-reference: anchorKind has a state-policy entry
//   3. cross-reference: styleProfile has a style-profiles entry
//   4. coverage: every app data-parity anchor is either fragmented or
//      explicitly recorded as an unfragmented finding
//
// Host-computable. Runtime pairing and cardinality against the live DOM
// belong to the S1 G1 runner in the F0 image; this gate only proves the
// fragments are well-formed and accounted for.

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { REPO_ROOT, SCHEMAS_DIR, hashCanonical, readJson } from "./shared"

const MANIFEST_DIR = join(REPO_ROOT, "packages", "app", "e2e", "v110", "parity-manifest")
const FINDINGS = join(REPO_ROOT, "parity", "manifest-findings.json")
const STATE_POLICY = join(REPO_ROOT, "parity", "state-policy.json")
const STYLE_PROFILES = join(REPO_ROOT, "parity", "style-profiles.json")
const CENSUS = join(REPO_ROOT, "parity", "artifacts", "census-static.json")

const VIEWPORTS = ["desktop-wide", "desktop-compact", "tablet-portrait", "phone-portrait", "compact-landscape"]
const THEMES = ["dark", "light"]
const MATCH_KINDS = ["attribute", "semantic-key", "document-order"]
const DISPOSITIONS = [
  "port",
  "intentional-difference",
  "app-only-accessibility",
  "blocked-external",
  "retain-internal-instrumentation",
  "delete-dead-instrumentation",
]

const errors: string[] = []
const details: string[] = []
let fragments = 0
let markers = 0

if (!existsSync(MANIFEST_DIR)) {
  process.stderr.write(`missing directory: ${MANIFEST_DIR}\n`)
  process.exit(1)
}

const statePolicy = readJson<{ byAnchorKind: Record<string, unknown> }>(STATE_POLICY)
const styleProfiles = readJson<{ profiles: Record<string, unknown> }>(STYLE_PROFILES)
const findingsFile = readJson<{ findings: Array<{ id: string }> }>(FINDINGS)
const knownIds = new Set(findingsFile.findings.map((finding) => finding.id))

const files = readdirSync(MANIFEST_DIR).filter((file) => file.endsWith(".json")).sort()
const manifestHashes: Record<string, string> = {}

for (const file of files) {
  fragments += 1
  let data: Record<string, unknown>
  try {
    data = JSON.parse(readFileSync(join(MANIFEST_DIR, file), "utf8")) as Record<string, unknown>
    manifestHashes[file] = hashCanonical(data)
  } catch (cause) {
    errors.push(`${file}: unreadable (${String(cause).slice(0, 80)})`)
    continue
  }

  const required = [
    "schemaVersion",
    "id",
    "slice",
    "scene",
    "anchorKind",
    "reference",
    "app",
    "matchBy",
    "viewports",
    "themes",
    "stateVectors",
    "styleProfile",
    "mask",
    "disposition",
  ]
  for (const key of required) if (!(key in data)) errors.push(`${file}: missing required ${key}`)
  for (const key of Object.keys(data)) if (!required.includes(key)) errors.push(`${file}: unexpected property ${key}`)

  if (typeof data.slice !== "string" || !/^S[0-9]+$/.test(data.slice)) errors.push(`${file}: slice must match ^S[0-9]+$`)

  for (const side of ["reference", "app"] as const) {
    const obj = data[side] as Record<string, unknown> | undefined
    if (!obj) {
      errors.push(`${file}: ${side} missing`)
      continue
    }
    if (typeof obj.selector !== "string" || obj.selector.length === 0) errors.push(`${file}: ${side}.selector invalid`)
    if (typeof obj.count !== "number" || obj.count < 0) errors.push(`${file}: ${side}.count invalid`)
    if (typeof obj.visibleCount !== "number" || obj.visibleCount < 0) errors.push(`${file}: ${side}.visibleCount invalid`)
    if (obj.count !== undefined && obj.visibleCount !== undefined && (obj.visibleCount as number) > (obj.count as number)) {
      errors.push(`${file}: ${side}.visibleCount exceeds count`)
    }
  }

  const matchBy = data.matchBy as Record<string, unknown> | undefined
  if (!matchBy || !MATCH_KINDS.includes(matchBy.kind as string)) errors.push(`${file}: matchBy.kind invalid`)

  for (const viewport of (data.viewports as string[]) ?? []) {
    if (!VIEWPORTS.includes(viewport)) errors.push(`${file}: unknown viewport ${viewport}`)
  }
  for (const theme of (data.themes as string[]) ?? []) {
    if (!THEMES.includes(theme)) errors.push(`${file}: unknown theme ${theme}`)
  }

  if (!DISPOSITIONS.includes(data.disposition as string)) errors.push(`${file}: disposition invalid`)
  if (data.mask !== null) errors.push(`${file}: mask must be null for the pilot fragments`)

  if (!(data.anchorKind as string in statePolicy.byAnchorKind)) {
    errors.push(`${file}: anchorKind ${String(data.anchorKind)} has no state-policy entry`)
  }
  if (!(data.styleProfile as string in styleProfiles.profiles)) {
    errors.push(`${file}: styleProfile ${String(data.styleProfile)} has no style-profiles entry`)
  }

  details.push(`OK: ${file} (${String(data.id)} / ${String(data.anchorKind)})`)
}

// The census is a required input: without it the coverage and reverse checks
// would silently no-op, which is the fail-open behaviour the plan forbids.
// evidence-host runs parity:census before this gate, so a missing census here
// means the gate was invoked out of order.
const markersByKey = new Set<string>()
if (!existsSync(CENSUS)) {
  errors.push(`census missing at ${CENSUS}: run parity:census first (coverage + reverse checks cannot run)`)
} else {
  const census = readJson<{ markers: Array<{ kind: string; key: string }> }>(CENSUS)
  for (const marker of census.markers) {
    if (marker.kind === "data-parity") markersByKey.add(marker.key)
  }
}

const fragmentedKeys = new Set<string>()
for (const file of files) {
  const data = JSON.parse(readFileSync(join(MANIFEST_DIR, file), "utf8")) as Record<string, unknown>
  const app = data.app as Record<string, unknown> | undefined
  if (app && typeof app.selector === "string") {
    const match = app.selector.match(/data-parity="([^"]+)"/)
    if (match) fragmentedKeys.add(match[1]!)
  }
}

for (const key of markersByKey) {
  markers += 1
  if (fragmentedKeys.has(key) || knownIds.has(key)) continue
  errors.push(`coverage: app data-parity marker ${key} is neither fragmented nor a recorded finding`)
}

// Reverse direction: every fragment's app selector must point at a marker the
// census actually discovered in the source. A fragment referencing a marker
// that does not exist is a dangling contract that would never pair at runtime.
const censusKeys = new Set<string>()
if (existsSync(CENSUS)) {
  const census = readJson<{ markers: Array<{ kind: string; key: string }> }>(CENSUS)
  for (const marker of census.markers) {
    if (marker.kind === "data-parity" || marker.kind === "data-v110") censusKeys.add(marker.key)
  }
}

let dangling = 0
for (const file of files) {
  const data = JSON.parse(readFileSync(join(MANIFEST_DIR, file), "utf8")) as Record<string, unknown>
  const app = data.app as Record<string, unknown> | undefined
  const selector = app && typeof app.selector === "string" ? app.selector : ""
  const match = selector.match(/data-(?:parity|v110)="([^"]+)"/)
  if (!match) {
    errors.push(`${file}: app selector carries no data-parity/data-v110 marker`)
    continue
  }
  if (!censusKeys.has(match[1]!)) {
    dangling += 1
    errors.push(`${file}: app marker ${match[1]} is not present in the census`)
  }
}

const status = errors.length === 0 ? "PASS" : "FAIL"
process.stdout.write(
  JSON.stringify(
    {
      status,
      counters: {
        fragments,
        appDataParityMarkers: markers,
        fragmented: fragmentedKeys.size,
        findings: knownIds.size,
        censusKeys: censusKeys.size,
        danglingAppSelectors: dangling,
        errors: errors.length,
      },
      manifestHashes,
      errors,
      details,
    },
    null,
    2,
  ) + "\n",
)
process.exit(status === "PASS" ? 0 : 1)
