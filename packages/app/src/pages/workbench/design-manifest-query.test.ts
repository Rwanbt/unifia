/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { describe, expect, test } from "bun:test"
import { WorkbenchHttpError } from "@unifia/workbench-shell"
import { designManifestOrEmpty } from "./design-manifest-query"

describe("designManifestOrEmpty", () => {
  test("a workspace without a manifest (404) reads as an empty catalog", async () => {
    expect(await designManifestOrEmpty(async () => { throw new WorkbenchHttpError(404, false) })).toEqual({ designSystems: [] })
  })
  test("a real manifest passes through", async () => {
    const manifest = { designSystems: [{ id: "ds" }] }
    expect(await designManifestOrEmpty(async () => manifest)).toBe(manifest)
  })
  test("any other failure is still an error", async () => {
    await expect(designManifestOrEmpty(async () => { throw new WorkbenchHttpError(500, true) })).rejects.toBeInstanceOf(WorkbenchHttpError)
    await expect(designManifestOrEmpty(async () => { throw new WorkbenchHttpError(403, false) })).rejects.toBeInstanceOf(WorkbenchHttpError)
  })
})
