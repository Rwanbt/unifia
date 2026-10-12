/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { browserEgressPolicyForController } from "../src/egress-policy.ts"

describe("browser session egress policy", () => {
  test("keeps unrestricted public browsing under user control", () => {
    const policy = browserEgressPolicyForController(
      { allowedOrigins: ["*"], blockThirdPartyCookies: true, defaultDeny: true },
      "user",
      ["https://example.com"],
    )
    expect(policy.allowedOrigins).toEqual(["*"])
  })

  test("limits AI egress to origins visited or approved in the session", () => {
    const policy = browserEgressPolicyForController(
      { allowedOrigins: ["*"], blockThirdPartyCookies: true, defaultDeny: true },
      "ai",
      ["https://example.com", "https://approved.example"],
    )
    expect(policy.allowedOrigins).toEqual(["https://example.com", "https://approved.example"])
    expect(policy.allowedOrigins).not.toContain("*")
  })

  test("intersects session grants with a narrower configured policy", () => {
    const policy = browserEgressPolicyForController(
      { allowedOrigins: ["https://example.com"], blockThirdPartyCookies: true, defaultDeny: true },
      "ai",
      ["https://example.com", "https://other.example"],
    )
    expect(policy.allowedOrigins).toEqual(["https://example.com"])
  })

  test("denies all network egress while control is paused", () => {
    const policy = browserEgressPolicyForController(
      { allowedOrigins: ["*"], blockThirdPartyCookies: true, defaultDeny: true },
      "paused",
      ["https://example.com"],
    )
    expect(policy.allowedOrigins).toEqual([])
  })
})
