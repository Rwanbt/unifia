// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeEvidence } from "../src/qualification/evidence-writer"

describe("evidence writer", () => {
  test("response fields cannot select the output path", async () => {
    const root = await mkdtemp(join(tmpdir(), "rc0-evidence-"))
    const folder = join(root, "evidence", "dbos-go-sqlite", "FC-14")
    const payload = {
      authorityOwnerId: "../../outside.json",
      filename: "../../outside.json",
      path: "../../outside.json",
      __proto__: null,
      granted: true,
    }
    try {
      const output = await writeEvidence(folder, "result.json", payload)
      expect(output).toBe(join(folder, "result.json"))
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(payload)
      expect(await readdir(folder)).toEqual(["result.json"])
      expect(await readdir(root)).toEqual(["evidence"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("response text remains evidence content", async () => {
    const root = await mkdtemp(join(tmpdir(), "rc0-evidence-"))
    const payload = '../../outside.json\n{"filename":"../../outside.json"}'
    try {
      const output = await writeEvidence(root, "result.json", payload)
      expect(output).toBe(join(root, "result.json"))
      expect(await readFile(output, "utf8")).toBe(payload)
      expect(await readdir(root)).toEqual(["result.json"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
