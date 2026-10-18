/* SPDX-License-Identifier: MIT */
/**
 * One remote authority — the shipped HTTP surface — and no dormant engine
 * presented as one.
 *
 * Owner decision 9A (2026-10-16, PR #747): keep the remote/desktop paths the
 * product actually ships and secure their roles and actions (#716), while
 * `@unifia/remote-bridge` stays deferred — no control plane parallel to the
 * shipped server. Owner decision 8B (2026-10-17) supersedes the 9B deferral
 * for `@unifia/desktop-runtime`: Computer Use is REQUIRED for RC-1, so the
 * engine is composed by exactly one shipped module
 * (`server/desktop-surface.ts`), opt-in and fail-closed by default.
 * `REMOTE-CONTROL-RC1.md` records the reachable entry points and the access
 * boundary; the behavioral proof is `remote-control-authority.test.ts` against
 * the real HTTP server.
 *
 * What those cannot pin is the shape of the tree: a second importer of a
 * deferred engine, a second role decision module, or a server that stops
 * consulting the policy would silently re-open what 9A refuses. These
 * assertions read the shipped sources and pin the invariants ADR-1049 states.
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

describe("single remote authority", () => {
  test("shipped code imports no deferred engine — desktop-runtime only through its composition module", () => {
    const mentions = sources(src)
      .filter((file) => {
        const text = readFileSync(file, "utf8")
        return text.includes("@unifia/remote-bridge") || text.includes("@unifia/desktop-runtime")
      })
      .map((file) => file.slice(src.length + 1).replaceAll("\\", "/"))
    // remote-bridge has no shipped importer at all. desktop-runtime has exactly
    // the one module decision 8B names; a second importer anywhere else would
    // re-open the parallel control plane 9A refuses.
    expect(mentions).toEqual(["server/desktop-surface.ts"])
  })

  test("the role policy lives in one module, consumed by the server", () => {
    const server = sources(join(src, "server"))
    const definers = server.filter((file) => {
      const text = readFileSync(file, "utf8")
      return text.includes("function classify(") || text.includes("function permitted(")
    })
    expect(definers.map((file) => file.slice(src.length + 1).replaceAll("\\", "/"))).toEqual(["server/route-authority.ts"])
    // The server applies the policy before route handlers: the import is the
    // wiring that makes route-classes.ts binding rather than advisory.
    expect(read("server", "server.ts")).toContain('import { classify, permitted } from "./route-authority"')
  })
})
