/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const entrySource = readFileSync(resolve(import.meta.dir, "entry.tsx"), "utf8")

describe("web entry server gate", () => {
  test("keeps the local sidecar failure from blocking the web shell", () => {
    expect(entrySource).toMatch(/<AppProviders[\s\S]*?disableHealthCheck/)
  })
})
