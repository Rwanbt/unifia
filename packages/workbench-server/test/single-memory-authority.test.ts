/* SPDX-License-Identifier: MIT */
/**
 * ADR-096 (#569, owner decision 5A): the Sovereign Knowledge Core is the sole
 * canonical memory data, policy, write and disclosure authority.
 *
 * The shipped `@unifia/workbench-server` used to carry a second, dormant
 * authority: a `/v1/memory/:action` route over a generic `MemoryRuntime`
 * (remember/search/remove). Nothing composed it (`WorkbenchSurfaces` had no
 * `memory` field, the sidecar passed none), so every call answered 503 — but
 * the writer still existed in a distributed root, which is the exact shape
 * ADR-096's writers audit refuses. It was removed; this guard keeps it
 * removed.
 *
 * The scan is source-level on purpose (same pattern as
 * `packages/app/src/components/prompt-input/image-attachments.test.ts`): a
 * re-import added "only for reachability" is the rejected alternative in
 * ADR-096 and must fail here, not in a review.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..")
const SRC = join(ROOT, "src")

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : []
  })
}

describe("workbench-server ships no second memory authority (#569)", () => {
  test("no source references the memory-runtime authority or memory-governance", () => {
    const offenders = sources(SRC).filter((path) => {
      const text = readFileSync(path, "utf8")
      return /@unifia\/memory-runtime|MemoryRuntime|memory-governance/.test(text)
    })
    expect(offenders.map((path) => relative(ROOT, path))).toEqual([])
  })

  test("the dormant /v1/memory handler is gone", () => {
    expect(existsSync(join(SRC, "handlers", "memory.ts"))).toBe(false)
  })

  test("the package does not declare the memory-runtime dependency", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
    }
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain("@unifia/memory-runtime")
  })
})
