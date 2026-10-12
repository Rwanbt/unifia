// Guard: a fixture tmpdir() must be bound with `await using`, so disposal is the default. Any other
// binding leaves the directory to the test's own cleanup, which a timeout or crash skips.
import { describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as path from "path"

const TEST_ROOT = path.resolve(import.meta.dir, "..")
const DEFINITION = "fixture/fixture.ts"
const SELF = "fixture/non-disposing.test.ts"

// Call sites allowed to lack `await using`, keyed by path relative to test/. Each entry gives the number
// of such calls and why they are disposed anyway. The count must match exactly: a new call in a listed
// file fails, and an entry whose call was removed or converted fails as stale.
const ALLOWED: Record<string, { count: number; reason: string }> = {
  "effect/cross-spawn-spawner.test.ts": { count: 2, reason: "disposed by the Effect.acquireRelease release" },
  "effect/instance-state.test.ts": { count: 1, reason: "the fixtures are disposed in the finally block of the test" },
  "file/index.test.ts": { count: 1, reason: "setupSearchableRepo() returns the disposable; every caller uses await using" },
  "fixture/fixture.test.ts": { count: 1, reason: "tests explicit disposal and asserts the directory is gone" },
  "plugin/trigger.test.ts": { count: 1, reason: "project() returns the disposable; every caller uses await using" },
  "project/instance-lease.test.ts": { count: 1, reason: "the beforeEach fixture is disposed in afterEach" },
  "server/git-routes.test.ts": { count: 1, reason: "the beforeAll fixture is disposed in afterAll" },
  "server/lsp-routes.test.ts": { count: 1, reason: "the beforeAll fixture is disposed in afterAll" },
  "snapshot/snapshot.test.ts": { count: 1, reason: "bootstrap() returns the disposable; every caller uses await using" },
}

const IMPORTS_FIXTURE_TMPDIR = /import\s+(?:type\s+)?\{[^}]*\btmpdir\b[^}]*\}\s*from\s*["'][^"']*fixture(?:\/fixture)?["']/
const TMPDIR_CALL = /(^|[^.\w$])tmpdir\s*(<[^>]*>)?\s*\(/
const DISPOSED_BINDING = /\bawait\s+using\s+[\w$]+\s*=\s*(?:await\s+)?tmpdir\s*(?:<[^>]*>)?\s*\(/

// 1-based line numbers of fixture tmpdir() calls that are not bound with `await using`.
export function nonDisposingLines(source: string): number[] {
  if (!IMPORTS_FIXTURE_TMPDIR.test(source)) return []
  const found: number[] = []
  source.split("\n").forEach((line, index) => {
    const code = line.trim()
    if (code.startsWith("//") || code.startsWith("*")) return
    if (!TMPDIR_CALL.test(line) || /function\s+tmpdir\b/.test(line)) return
    if (DISPOSED_BINDING.test(line)) return
    found.push(index + 1)
  })
  return found
}

function testFiles(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) files.push(path.relative(TEST_ROOT, full).split(path.sep).join("/"))
    }
  }
  walk(TEST_ROOT)
  return files.filter((file) => file !== DEFINITION && file !== SELF).sort()
}

describe("fixture tmpdir() disposal guard", () => {
  test("classifies bare, assigned and mapped calls as non-disposing, and await using as disposing", () => {
    const withImport = (body: string) => `import { tmpdir } from "./fixture"\n${body}`
    expect(nonDisposingLines(withImport("const t = await tmpdir()"))).toEqual([2])
    expect(nonDisposingLines(withImport("await Promise.all(xs.map(() => tmpdir()))"))).toEqual([2])
    expect(nonDisposingLines(withImport("await using t = await tmpdir({ git: true })"))).toEqual([])
    expect(nonDisposingLines(withImport("const p = os.tmpdir()"))).toEqual([])
    expect(nonDisposingLines(`import { tmpdir } from "node:os"\nconst t = tmpdir()`)).toEqual([])
  })

  test("every fixture tmpdir() call is bound with await using, or allowlisted with a reason", () => {
    const actual = new Map<string, number[]>()
    for (const file of testFiles()) {
      const lines = nonDisposingLines(fs.readFileSync(path.join(TEST_ROOT, file), "utf8"))
      if (lines.length > 0) actual.set(file, lines)
    }
    const files = new Set([...actual.keys(), ...Object.keys(ALLOWED)])
    const mismatches: string[] = []
    for (const file of [...files].sort()) {
      const found = actual.get(file)?.length ?? 0
      const allowed = ALLOWED[file]?.count ?? 0
      if (found !== allowed) {
        const lines = actual.get(file)?.join(", ") ?? "none"
        mismatches.push(`${file}: ${found} without await using (lines ${lines}), ${allowed} allowed`)
      }
    }
    expect(mismatches).toEqual([])
  })
})
