/* SPDX-License-Identifier: MIT */
/**
 * The observability chain has one shipped authority — the one that ships.
 *
 * Owner decision 7A (2026-10-16, PR #747) keeps the observability chain the
 * product actually runs — capture, sanitize, retain, project, export
 * (`packages/unifia/src/observability/*`) — and keeps `@unifia/observability`,
 * the kernel-side logger foundation, deferred: no parallel logging authority
 * and no production-reachability pretense.
 *
 * The behavioral proofs live with the chain itself (`runtime-export`,
 * `observability-exporters-routes` for the real HTTP surface, `resilience`,
 * `purge`, `sanitizer`). What they cannot pin is the shape of the tree: an
 * import of the deferred package, a second service construction, or a second
 * projection definition added later would silently create the second authority
 * 7A refuses. These assertions read the shipped sources and pin the three
 * invariants ADR-1048 states.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const src = join(import.meta.dir, "..", "..", "src")

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith(".ts") ? [path] : []
  })
}

function read(...parts: string[]): string {
  return readFileSync(join(src, ...parts), "utf8")
}

describe("single observability authority", () => {
  test("shipped code never imports the deferred @unifia/observability package", () => {
    const mentions = sources(src).filter((file) => readFileSync(file, "utf8").includes("@unifia/observability"))
    expect(mentions.map((file) => file.slice(src.length + 1).replaceAll("\\", "/"))).toEqual([])
  })

  test("the chain runs as one service, constructed only by its runtime", () => {
    const files = sources(src).map((file) => ({ path: file.slice(src.length + 1).replaceAll("\\", "/"), text: readFileSync(file, "utf8") }))
    const constructions = files.filter((file) => file.text.includes("new ObservabilityService("))
    expect(constructions.map((file) => file.path)).toEqual(["observability/runtime.ts"])
  })

  test("the export projection has a single definition, driven by the runtime", () => {
    const files = sources(src).map((file) => ({ path: file.slice(src.length + 1).replaceAll("\\", "/"), text: readFileSync(file, "utf8") }))
    const definers = files.filter((file) => file.text.includes("function toExportProjection("))
    expect(definers.map((file) => file.path)).toEqual(["observability/export-projection.ts"])
    // ADR-1026: exporters only ever receive the validated projection, and the
    // runtime's export tick is the single driver of that path.
    expect(read("observability", "runtime.ts")).toContain("toExportProjection")
    expect(read("observability", "runtime.ts")).toContain("exportToAll")
  })
})
