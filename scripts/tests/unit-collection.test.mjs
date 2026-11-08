// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"
import { audit, findOwner, scriptCovers, readWorkspaceManifests, trackedFiles } from "../verify-unit-collection.mjs"

const main = { dir: "packages/foo", scripts: { test: "bun test test", "test:ci": "bun run test" } }
const child = { dir: "packages/foo/nested", scripts: { test: "bun test src", "test:ci": "bun run test" } }

test("the nearest package manifest owns nested workspace tests", () => {
  assert.equal(findOwner("packages/foo/nested/src/child.test.ts", [main, child]), child)
})

test("tests added outside an explicit selector fail the collection gate", () => {
  const result = audit([main], [
    "packages/foo/test/covered.test.ts",
    "packages/foo/src/uncollected.test.ts",
  ], new Map())
  assert.equal(result.covered, 1)
  assert.deepEqual(result.missing, [
    { file: "packages/foo/src/uncollected.test.ts", reason: "not selected by test:ci" },
  ])
})

test("a package with no unit CI gate is not counted as covered", () => {
  const result = audit([{ dir: "packages/foo", scripts: { test: "bun test" } }], [
    "packages/foo/test/missing.test.ts",
  ], new Map())
  assert.equal(result.covered, 0)
  assert.equal(result.missing[0]?.reason, "missing test:ci")
  assert.equal(result.invalid[0]?.reason, "test exists without test:ci")
})

test("a stale exception cannot silently outlive the excluded test", () => {
  const result = audit([main], ["packages/foo/test/covered.test.ts"], new Map([
    ["packages/foo/test/removed.test.ts", "old exception"],
  ]))
  assert.equal(result.invalid[0]?.reason, "stale exception")
})

test("unit CLI selection recognizes explicit, directory and unscoped Bun invocations", () => {
  assert.equal(scriptCovers("test/a.test.ts", "bun test test"), true)
  assert.equal(scriptCovers("src/a.test.ts", "bun test test"), false)
  assert.equal(scriptCovers("src/a.test.ts", "bun test --timeout 180000 --reporter=junit"), true)
  assert.equal(scriptCovers("test/a.test.ts", "bun test test/a.test.ts test/b.test.ts"), true)
  assert.equal(scriptCovers("test/c.test.ts", "bun test test/a.test.ts test/b.test.ts"), false)
  assert.equal(scriptCovers("src/a.test.ts", "bun --preload ./happydom.ts src/a.test.ts"), true)
})

test("the actual repository unit gate covers every tracked unit file or documents an exception", () => {
  const result = audit(readWorkspaceManifests(), trackedFiles())
  assert.equal(result.missing.length, 0, JSON.stringify(result.missing.slice(0, 8)))
  assert.equal(result.invalid.length, 0, JSON.stringify(result.invalid.slice(0, 8)))
  assert.ok(result.covered > 1000)
  assert.equal(result.excluded.length, 2)
})
