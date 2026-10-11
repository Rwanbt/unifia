/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { basicCredentialsMatch } from "../../src/server/basic-credentials"

const USER = "unifia"
const PASSWORD = "operator-secret"

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64")

describe("basicCredentialsMatch: the operator's credentials, as a Basic header carries them", () => {
  test("accepts the configured user and password", () => {
    expect(basicCredentialsMatch(encode(`${USER}:${PASSWORD}`), USER, PASSWORD)).toBe(true)
  })

  test("accepts a password that contains colons: the user name ends at the first colon", () => {
    // Splitting on every colon kept only the text before the second one, so such a password could never match.
    const withColons = "part:one:part:two"
    expect(basicCredentialsMatch(encode(`${USER}:${withColons}`), USER, withColons)).toBe(true)
  })

  test("refuses a wrong password", () => {
    expect(basicCredentialsMatch(encode(`${USER}:not-the-password`), USER, PASSWORD)).toBe(false)
  })

  test("refuses a wrong user name, even with the right password", () => {
    expect(basicCredentialsMatch(encode(`someone:${PASSWORD}`), USER, PASSWORD)).toBe(false)
  })

  test("refuses a prefix of the real password: a mismatch is a mismatch, whatever its length", () => {
    expect(basicCredentialsMatch(encode(`${USER}:${PASSWORD.slice(0, -1)}`), USER, PASSWORD)).toBe(false)
    expect(basicCredentialsMatch(encode(`${USER}:${PASSWORD}x`), USER, PASSWORD)).toBe(false)
  })

  test("refuses a value with no colon at all", () => {
    expect(basicCredentialsMatch(encode(PASSWORD), USER, PASSWORD)).toBe(false)
  })

  test("refuses an empty value without throwing", () => {
    expect(basicCredentialsMatch("", USER, PASSWORD)).toBe(false)
  })

  test("refuses a value that is not valid base64 without throwing", () => {
    expect(() => basicCredentialsMatch("%%%not base64%%%", USER, PASSWORD)).not.toThrow()
    expect(basicCredentialsMatch("%%%not base64%%%", USER, PASSWORD)).toBe(false)
  })
})
