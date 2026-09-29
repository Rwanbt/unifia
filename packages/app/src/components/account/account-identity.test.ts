/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { accountIdentity, initials, osName } from "./account-identity"

describe("account identity", () => {
  test("initials_NamesAndHandles_TakeTwoLetters", () => {
    expect(initials("Erwan Barat")).toBe("EB")
    expect(initials("user")).toBe("U")
    expect(initials("jane.doe")).toBe("JD")
    expect(initials("  ")).toBe("U")
  })

  test("accountIdentity_NoUser_IsTheLocalProfile", () => {
    expect(accountIdentity(undefined)).toEqual({ name: "User", initials: "U", signedIn: false })
  })

  test("accountIdentity_SignedIn_PrefersDisplayName", () => {
    const identity = accountIdentity({ username: "jdoe", displayName: "Jane Doe", email: "j@x.io", role: "admin" })
    expect(identity).toEqual({ name: "Jane Doe", initials: "JD", email: "j@x.io", role: "admin", signedIn: true })
    expect(accountIdentity({ username: "jdoe", displayName: " ", role: "member" }).name).toBe("jdoe")
  })

  test("osName_KnownPlatforms_AreProperNouns", () => {
    expect(osName("windows")).toBe("Windows")
    expect(osName("macos")).toBe("macOS")
    expect(osName(undefined)).toBeUndefined()
  })
})
