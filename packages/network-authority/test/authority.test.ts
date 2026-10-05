/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { isPublicAddress, NetworkAuthority, NetworkPolicyError } from "../src/index.ts"

const policy = { allowedOrigins: ["https://example.com"], blockThirdPartyCookies: true, defaultDeny: true } as const
const authority = (addresses: readonly string[]) => new NetworkAuthority(async () => addresses)

describe("NetworkAuthority", () => {
  test("authorizes canonical allowlisted public destinations", async () => {
    const destination = await authority(["93.184.216.34"]).authorizeBrowserUrl("https://example.com/path", policy)
    expect(destination.origin).toBe("https://example.com")
    expect(destination.addresses).toEqual(["93.184.216.34"])
  })

  test("validates public IPv6 literals without passing bracket syntax to DNS", async () => {
    const destination = await authority([]).authorizeBrowserUrl("https://[2001:4860:4860::8888]/", {
      ...policy,
      allowedOrigins: ["https://[2001:4860:4860::8888]"],
    })
    expect(destination.addresses).toEqual(["2001:4860:4860::8888"])
  })

  test("denies private, loopback, link-local, mapped-private and reserved IPv6 addresses", async () => {
    for (const address of [
      "10.0.0.1", "127.0.0.1", "169.254.169.254", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1",
      "2001:db8::1", "2d00::1", "2e00::1", "3000::1", "3fff::1", "5f00::1",
    ]) {
      expect(isPublicAddress(address)).toBe(false)
    }
  })

  test("keeps allocated global-unicast IPv6 destinations eligible", () => {
    for (const address of ["2001:4860:4860::8888", "2404:6800:4004::200e", "2a00:1450:4001::1"]) {
      expect(isPublicAddress(address)).toBe(true)
    }
  })

  test("rejects non-allowlisted origins and credential-bearing URLs", async () => {
    await expect(authority(["93.184.216.34"]).authorizeBrowserUrl("https://other.example", policy)).rejects.toMatchObject({ code: "origin-denied" })
    await expect(authority(["93.184.216.34"]).authorizeBrowserUrl("https://user:secret@example.com", policy)).rejects.toMatchObject({ code: "invalid-url" })
  })

  test("denies a mixed public and private DNS answer set", async () => {
    await expect(authority(["93.184.216.34", "192.168.1.2"]).authorizeBrowserUrl("https://example.com", policy)).rejects.toMatchObject({ code: "address-denied" })
  })
})
