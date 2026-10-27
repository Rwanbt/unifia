/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { errorMessage, splitPackageNames } from "./settings-dev-environment-model"

describe("splitPackageNames", () => {
  test("splits on spaces, commas and newlines and drops blanks", () => {
    expect(splitPackageNames("lua5.4  git,curl\n")).toEqual(["lua5.4", "git", "curl"])
  })

  test("returns nothing for a blank field", () => {
    expect(splitPackageNames("   ")).toEqual([])
  })

  test("keeps the first occurrence of a repeated name", () => {
    expect(splitPackageNames("git git lua5.4 git")).toEqual(["git", "lua5.4"])
  })
})

describe("errorMessage", () => {
  test("prefers the server's message under data", () => {
    expect(errorMessage({ name: "ContainerRefused", data: { message: "not an OCI image reference" } })).toBe(
      "not an OCI image reference",
    )
  })

  test("reads a thrown Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
  })

  test("falls back to the error name when there is no message", () => {
    expect(errorMessage({ name: "UnknownError" })).toBe("UnknownError")
  })

  test("stringifies anything else", () => {
    expect(errorMessage("plain")).toBe("plain")
  })
})
