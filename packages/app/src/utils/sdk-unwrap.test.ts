/* SPDX-License-Identifier: MIT */
import { afterEach, describe, expect, test } from "bun:test"
import { unwrap } from "./sdk-unwrap"

describe("unwrap", () => {
  afterEach(() => {
    document.documentElement.lang = ""
  })

  test("returns data when the SDK result carries it", async () => {
    await expect(unwrap(Promise.resolve({ data: 42 }))).resolves.toBe(42)
  })

  test("rejects with the SDK error's own message when it is an Error", async () => {
    await expect(unwrap(Promise.resolve({ error: new Error("boom") }))).rejects.toThrow("boom")
  })

  test("falls back to a French message when document.lang is fr", async () => {
    document.documentElement.lang = "fr"
    await expect(unwrap(Promise.resolve({ error: "not-an-error-instance" }))).rejects.toThrow(
      "La demande a échoué",
    )
  })

  test("falls back to English for a locale with no translation", async () => {
    document.documentElement.lang = "de"
    await expect(unwrap(Promise.resolve({ error: "not-an-error-instance" }))).rejects.toThrow(
      "Request failed",
    )
  })
})
