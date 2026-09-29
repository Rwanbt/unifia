/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { compactTokens, relativePath } from "./format"

describe("relativePath", () => {
  test("strips the workspace root from a Windows file URI, case-insensitively", () => {
    expect(relativePath("file:///d%3A/App/unifia/src/a.ts", "D:\\App\\Unifia")).toBe("src/a.ts")
    expect(relativePath("file:///D:/App/unifia/src/a.ts", "D:\\App\\unifia\\")).toBe("src/a.ts")
  })

  test("keeps a path outside the workspace absolute", () => {
    expect(relativePath("file:///D:/other/b.ts", "D:\\App\\unifia")).toBe("D:/other/b.ts")
  })
})

describe("compactTokens", () => {
  test("writes thousands and millions like the reference", () => {
    expect(compactTokens(512)).toBe("512")
    expect(compactTokens(51_400)).toBe("51.4k")
    expect(compactTokens(1_048_576)).toBe("1.0M")
  })
})
