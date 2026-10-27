/* SPDX-License-Identifier: MIT */
import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readMobileLoadFailure } from "../../src/local-llm-server/mobile-load-failure"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-failure-"))
const home = path.join(dir, "home")
const ipc = path.join(dir, "llm_ipc")
fs.mkdirSync(ipc)
afterEach(() => fs.rmSync(path.join(ipc, "load_failure"), { force: true }))

test("reports a failure only for the selected model", () => {
  fs.writeFileSync(path.join(ipc, "load_failure"), "Spark-X2.6-4B-Q8_0.gguf\nunknown model architecture: 'spark2_5'\n")
  expect(readMobileLoadFailure(home, "Spark-X2.6-4B")).toContain("unknown model architecture: 'spark2_5'")
  expect(readMobileLoadFailure(home, "other-model")).toBeUndefined()
})

test("ignores missing or incomplete status", () => {
  expect(readMobileLoadFailure(home, "Spark-X2.6-4B")).toBeUndefined()
  fs.writeFileSync(path.join(ipc, "load_failure"), "Spark-X2.6-4B-Q8_0.gguf\n")
  expect(readMobileLoadFailure(home, "Spark-X2.6-4B")).toBeUndefined()
})
