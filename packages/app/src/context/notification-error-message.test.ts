/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { sessionErrorMessage } from "./notification"

describe("sessionErrorMessage", () => {
  test("SessionErrorMessage_NamedErrorObject_ReturnsItsMessage", () => {
    const error = { name: "UnknownError", data: { message: "Failed to load plugin @x/quota@latest: Export named 'parse' not found" } }
    expect(sessionErrorMessage(error)).toBe("Failed to load plugin @x/quota@latest: Export named 'parse' not found")
  })

  test("SessionErrorMessage_PlainString_IsKept", () => {
    expect(sessionErrorMessage("boom")).toBe("boom")
  })

  test("SessionErrorMessage_NothingReadable_ReturnsUndefined", () => {
    expect(sessionErrorMessage(undefined)).toBeUndefined()
    expect(sessionErrorMessage({ name: "X" })).toBeUndefined()
    expect(sessionErrorMessage({ data: { message: "" } })).toBeUndefined()
    expect(sessionErrorMessage("")).toBeUndefined()
  })
})
