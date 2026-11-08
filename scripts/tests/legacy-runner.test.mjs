// SPDX-License-Identifier: MIT
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const runner = fileURLToPath(new URL("../run-legacy-unit.mjs", import.meta.url))
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)))

function fixture(body) {
  // Keep fixtures on the checkout disk instead of the potentially full C: TEMP.
  const cwd = mkdtempSync(join(root, ".unit-legacy-fixture-"))
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "unit-legacy-fixture", scripts: { test: "bun fixture.ts" } }))
  writeFileSync(join(cwd, "fixture.ts"), body)
  return cwd
}

function run(body) {
  const cwd = fixture(body)
  try {
    return spawnSync(process.execPath, [runner], {
      cwd, encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024,
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

describe("legacy assertion runner fails closed", () => {
  test("accepts a complete nonzero assertion counter", () => {
    const result = run('console.log("Adapter: 3/3 passed")\n')
    assert.equal(result.status, 0, result.stderr + result.stdout)
  })
  test("rejects zero assertions", () => {
    const result = run('console.log("Adapter: 0/0 passed")\n')
    assert.notEqual(result.status, 0)
  })
  test("rejects a partial assertion counter", () => {
    const result = run('console.log("Adapter: 2/3 passed")\n')
    assert.notEqual(result.status, 0)
  })
  test("rejects a script that silently reports nothing", () => {
    const result = run('console.log("all good")\n')
    assert.notEqual(result.status, 0)
  })
  test("rejects a failed process despite a complete counter", () => {
    const result = run('console.log("Adapter: 2/2 passed")\nprocess.exit(1)\n')
    assert.notEqual(result.status, 0)
  })
})
