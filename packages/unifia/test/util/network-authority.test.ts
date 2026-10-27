/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { caresResolver, networkAuthorityFor } from "../../src/util/network-authority"
import { parseBrowserEgressPolicy } from "@unifia/contracts"

const policy = parseBrowserEgressPolicy({ allowedOrigins: ["https://dl-cdn.alpinelinux.org"], defaultDeny: true })

test("the c-ares resolver merges IPv4 and IPv6 and tolerates one family failing", async () => {
  const both = caresResolver({ resolve4: async () => ["151.101.2.132"], resolve6: async () => ["2a04:4e42::644"] })
  expect(await both("dl-cdn.alpinelinux.org")).toEqual(["151.101.2.132", "2a04:4e42::644"])
  const v4only = caresResolver({ resolve4: async () => ["151.101.2.132"], resolve6: async () => Promise.reject(new Error("ENODATA")) })
  expect(await v4only("dl-cdn.alpinelinux.org")).toEqual(["151.101.2.132"])
  const none = caresResolver({ resolve4: async () => Promise.reject(new Error("ENOTFOUND")), resolve6: async () => Promise.reject(new Error("ENODATA")) })
  await expect(none("nowhere.invalid")).rejects.toThrow("ENOTFOUND")
})

test("the c-ares path still refuses private addresses through the Network Authority", async () => {
  const { NetworkAuthority } = await import("@unifia/network-authority")
  const rebinding = new NetworkAuthority(caresResolver({ resolve4: async () => ["10.0.0.5"], resolve6: async () => [] }))
  await expect(rebinding.authorizeBrowserUrl("https://dl-cdn.alpinelinux.org/x", policy)).rejects.toThrow(/non-public/)
})

// Real DNS: the resolver the phone uses must answer for the hosts the manager needs.
test("the embedded-mobile authority resolves the Alpine CDN through c-ares for real", async () => {
  const destination = await networkAuthorityFor({ UNIFIA_CLIENT: "mobile-embedded" }).authorizeBrowserUrl("https://dl-cdn.alpinelinux.org/alpine/", policy)
  expect(destination.addresses.length).toBeGreaterThan(0)
})
