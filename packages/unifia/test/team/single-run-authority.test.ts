/* SPDX-License-Identifier: MIT */
/**
 * The Team run control has exactly one authority in the shipped tree.
 *
 * PR #713 unified the native Team tool and the HTTP lifecycle endpoints on one
 * process-wide registry (`teamRunRegistry`). Before it, the routes constructed
 * their own `TeamRunRegistry` while `runOpenCodeTeam` defaulted to another, so
 * a run started through the native entry could not be paused over HTTP — the
 * divergence this guard exists to keep from coming back.
 *
 * The behavioral proof lives in `test/server/team-routes.test.ts` ("controls a
 * run started through the native Team application entry"). What a behavioral
 * test cannot pin is the shape of the tree: a second construction site added
 * later, in a path the tests happen not to exercise, would silently reopen the
 * divergence. So these assertions read the shipped sources themselves.
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

describe("single Team run authority", () => {
  test("only the singleton module constructs a TeamRunRegistry", () => {
    const files = sources(src).map((file) => ({ path: file.slice(src.length + 1).replaceAll("\\", "/"), text: readFileSync(file, "utf8") }))
    const constructions = files.filter((file) => file.text.includes("new TeamRunRegistry("))
    expect(constructions.map((file) => file.path)).toEqual(["team/run-registry.ts"])
  })

  test("both shipped entries reach that same registry", () => {
    // The HTTP lifecycle routes drive the process-wide singleton...
    expect(read("server", "routes", "team.ts")).toContain("teamRunRegistry")
    // ...and the native entry runs through the application, which defaults to
    // the same singleton when no explicit registry is injected.
    expect(read("tool", "team.ts")).toContain("runOpenCodeTeam")
    expect(read("team", "opencode-application.ts")).toContain("options.registry ?? teamRunRegistry")
  })
})
