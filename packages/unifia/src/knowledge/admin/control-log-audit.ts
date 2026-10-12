/* SPDX-License-Identifier: MIT */
/**
 * Diagnostics and export of the egress control log (admin conventions).
 *
 * `verifyControlLog` is read-only: it reports the sequence range, the number of
 * generations, the chain status and the size, and it names the first gap or
 * mismatch it finds. It writes nothing and creates nothing.
 *
 * `exportControlLog` copies every generation byte for byte into a folder outside
 * the trail, with a manifest that hashes each copy and records what the verifier
 * said at export time. `verifyControlLogExport` checks such a folder later,
 * without the workspace it came from: a changed copy is named, and the chain of
 * the copies is verified again.
 *
 * The export is for the owner, who is taking a copy of their own record. It is
 * not a third-party release: the trail carries hashes and destinations, never
 * note text, so there is nothing for a `exportable` restriction to withhold.
 */

import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { KnowledgeFailure } from "../domain/errors.js"
import { wouldBeContained } from "../source/containment.js"
import { CONTROL_LOG_FILE, CONTROL_LOG_GENERATIONS } from "../policy/control-log.js"
import {
  readRawTrail,
  readVerifiedTrail,
  sha256,
  verifyRawTrail,
  type RawGeneration,
  type TrailReport,
} from "../policy/control-log-generations.js"

/** The manifest written beside an export. */
export const CONTROL_LOG_EXPORT_MANIFEST = "control-log-export.json"

/** The folder that holds the trail of a workspace. */
function trailDirOf(workspaceRoot: string): string {
  return dirname(join(workspaceRoot, CONTROL_LOG_FILE))
}

export interface ControlLogVerifyOptions {
  /** How many generations are retained; defaults to the production bound. */
  generations?: number
}

/** Check the trail of a workspace. Read-only. */
export function verifyControlLog(workspaceRoot: string, options: ControlLogVerifyOptions = {}): TrailReport {
  return readVerifiedTrail(trailDirOf(workspaceRoot), options.generations ?? CONTROL_LOG_GENERATIONS).report
}

export interface ExportedGeneration {
  name: string
  bytes: number
  sha256: string
}

export interface ControlLogExportManifest {
  exportedAt: string
  generations: ExportedGeneration[]
  /** What the verifier found when the export was taken. An export of a broken trail is still an export, and says so. */
  verification: TrailReport
}

export interface ControlLogExportInput {
  workspaceRoot: string
  /** Absolute path of the folder the export is written into. Must lie outside the trail. */
  destination: string
  generations?: number
}

/** Copy every generation of a workspace's trail into `destination`, with a manifest. */
export function exportControlLog(input: ControlLogExportInput): ControlLogExportManifest {
  if (!isAbsolute(input.workspaceRoot) || !isAbsolute(input.destination)) {
    throw KnowledgeFailure.pathUnresolved("workspaceRoot and destination must be absolute")
  }
  const trailDir = trailDirOf(input.workspaceRoot)
  // An export written into the trail it copies would be read back into the next export, and grow without bound.
  if (wouldBeContained(trailDir, input.destination)) {
    throw KnowledgeFailure.mutationRefused("destination must be outside the trail it exports")
  }
  const retention = input.generations ?? CONTROL_LOG_GENERATIONS
  const raw = readRawTrail(trailDir)
  const verification = verifyRawTrail(raw, retention).report
  mkdirSync(input.destination, { recursive: true, mode: 0o700 })
  const generations = raw.generations.map((g) => copyOut(input.destination, g))
  const manifest: ControlLogExportManifest = { exportedAt: new Date().toISOString(), generations, verification }
  writeOwnerOnly(join(input.destination, CONTROL_LOG_EXPORT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function copyOut(destination: string, generation: RawGeneration): ExportedGeneration {
  writeOwnerOnly(join(destination, generation.name), generation.text)
  return {
    name: generation.name,
    bytes: Buffer.byteLength(generation.text, "utf8"),
    sha256: sha256(generation.text),
  }
}

/** Owner-only: the copies hold hashes and destinations, which are not for other accounts on the machine. */
function writeOwnerOnly(path: string, text: string): void {
  writeFileSync(path, text, { encoding: "utf8", mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Where the platform does not keep modes the file keeps the access of its folder.
  }
}

export interface ControlLogExportCheck {
  ok: boolean
  /** Generations the manifest names that are not in the folder. */
  missing: string[]
  /** Generations whose bytes no longer match the hash the manifest recorded. */
  altered: string[]
  /** The chain of the copies, verified again. */
  verification: TrailReport | null
}

/** Check an export against its manifest, and verify its chain, without the original workspace. */
export function verifyControlLogExport(destination: string): ControlLogExportCheck {
  const manifest = JSON.parse(readFileSync(join(destination, CONTROL_LOG_EXPORT_MANIFEST), "utf8")) as ControlLogExportManifest
  const missing: string[] = []
  const altered: string[] = []
  const copies: RawGeneration[] = []
  for (const generation of manifest.generations) {
    let text: string
    try {
      text = readFileSync(join(destination, generation.name), "utf8")
    } catch {
      missing.push(generation.name)
      continue
    }
    copies.push({ name: generation.name, text })
    if (sha256(text) !== generation.sha256) altered.push(generation.name)
  }
  const verification = verifyRawTrail({ generations: copies, pendingCommit: false, orphanTemp: false }, copies.length).report
  return {
    ok: missing.length === 0 && altered.length === 0 && verification.ok,
    missing,
    altered,
    verification,
  }
}
