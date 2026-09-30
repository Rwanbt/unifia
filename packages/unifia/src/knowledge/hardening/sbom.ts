/* SPDX-License-Identifier: MIT */
/**
 * SBOM placeholder (P11.3).
 *
 * V1: walk the workspace, list the declared dependencies in
 * each `package.json`, and emit a CycloneDX-like JSON skeleton.
 * Real SBOM generation is delegated to `bunx @cyclonedx/cyclonedx-npm`
 * in CI; this stub is the testable surface.
 */

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  type BigIntStats,
} from "node:fs"
import { join } from "node:path"
import { KnowledgeFailure } from "../domain/errors.js"
import { isContained, realOrNull } from "../source/containment.js"

export interface SbomComponent {
  type: "library" | "application"
  name: string
  version: string
  purl: string
}

export interface Sbom {
  bomFormat: "CycloneDX"
  specVersion: "1.5"
  version: number
  components: SbomComponent[]
}

export function buildSbomFromPackages(workspaceRoot: string): Sbom {
  const components: SbomComponent[] = []
  const realRoot = realOrNull(workspaceRoot)
  if (realRoot === null) return { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, components }
  walk(workspaceRoot, (dir) => {
    const pkgPath = join(dir, "package.json")
    const realPackagePath = realOrNull(pkgPath)
    if (realPackagePath === null || !isContained(realRoot, realPackagePath)) return
    try {
      const raw = readPackageManifest(realPackagePath, pkgPath)
      if (raw === null) return
      const json = JSON.parse(raw) as {
        name?: string
        version?: string
        dependencies?: Record<string, string>
      }
      if (typeof json.name !== "string" || typeof json.version !== "string") return
      components.push({
        type: "application",
        name: json.name,
        version: json.version,
        purl: `pkg:npm/${json.name}@${json.version}`,
      })
      if (json.dependencies) {
        for (const [name, ver] of Object.entries(json.dependencies)) {
          if (typeof ver !== "string") continue
          components.push({
            type: "library",
            name,
            version: ver.replace(/^[\^~]/, ""),
            purl: `pkg:npm/${name}@${ver.replace(/^[\^~]/, "")}`,
          })
        }
      }
    } catch (error) {
      if (error instanceof KnowledgeFailure && error.kind === "path_unresolved") throw error
      // ignore
    }
  })
  return { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, components }
}

function readPackageManifest(realPath: string, locator: string): string | null {
  let before: BigIntStats
  try {
    before = lstatSync(realPath, { bigint: true }) as BigIntStats
  } catch {
    return null
  }

  let descriptor: number
  try {
    descriptor = openSync(realPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw KnowledgeFailure.pathUnresolved(`package manifest became a link: ${locator}`)
    }
    return null
  }

  try {
    const opened = fstatSync(descriptor, { bigint: true })
    const after = lstatSync(realPath, { bigint: true })
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.ctimeNs !== before.ctimeNs ||
      opened.mtimeNs !== before.mtimeNs ||
      opened.birthtimeNs !== before.birthtimeNs ||
      opened.size !== before.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.ctimeNs !== opened.ctimeNs ||
      after.mtimeNs !== opened.mtimeNs ||
      after.birthtimeNs !== opened.birthtimeNs ||
      after.size !== opened.size
    ) {
      throw KnowledgeFailure.pathUnresolved(`package manifest identity changed: ${locator}`)
    }
    return readFileSync(descriptor, "utf8")
  } finally {
    closeSync(descriptor)
  }
}

function walk(dir: string, visit: (dir: string) => void): void {
  visit(dir)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "target" || name === "dist") continue
    const full = join(dir, name)
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full, visit)
    } catch {
      // ignore
    }
  }
}
