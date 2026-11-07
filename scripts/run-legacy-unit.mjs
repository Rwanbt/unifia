// SPDX-License-Identifier: MIT
// Register legacy assertion scripts as one real Node test, checking both exit
// status and their own executed/total assertion counters. A bare "bun file.ts"
// can exit 0 while Bun reports zero collected test cases.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { basename } from "node:path"

test("legacy unit assertions execute with no silently skipped cases: " + basename(process.cwd()), { timeout: 180_000 }, () => {
  const result = spawnSync("bun", ["run", "test"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 170_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CI: "true" },
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr)
  const output = result.stdout + "\n" + result.stderr
  if (process.argv.includes("--release-gates")) {
    assert.match(output, /ReleaseHardening: \d+\/\d+ scenarios accounted for/)
    assert.match(output, /GateB: GO/)
    assert.match(output, /GateC: NO-GO/)
    assert.doesNotMatch(output, /Gate B condition failed|Gate C condition failed/)
    console.log("Release gate assertions executed and classified (Gate C remains explicitly NO-GO)")
    return
  }
  const counters = [...output.matchAll(/\b(\d+)\/(\d+) passed\b/g)]
  assert.ok(counters.length > 0, "legacy script did not report its executed assertions")
  for (const [, executed, total] of counters) {
    assert.ok(Number(total) > 0, "legacy script reported zero assertions")
    assert.equal(Number(executed), Number(total), "legacy assertion count is incomplete")
  }
  console.log("Legacy unit counters verified: " + counters.map((m) => m[0]).join(", "))
})
