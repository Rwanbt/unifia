/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"
import { parsePairingLink } from "./pairing-link"

const link = (target: string, extra = "") => `unifia://connect?url=${encodeURIComponent(target)}${extra}`

test("PairingLink_ValidTarget_PrefillsWithoutSelecting", () => {
  expect(parsePairingLink(link("https://192.168.1.20:4096", "&user=erwan&pwd=secret"))).toEqual({
    http: { url: "https://192.168.1.20:4096", username: "erwan", password: "secret" },
    fingerprint: null,
  })
  expect(parsePairingLink("unifia:connect?url=http%3A%2F%2Flocalhost%3A4096")?.http.username).toBe("unifia")
})

test("PairingLink_UnsafeTarget_IsRejected", () => {
  for (const url of ["javascript:alert(1)", "file:///secret", "data:text/plain,hello", "unifia://open", "bad-url"]) {
    expect(parsePairingLink(link(url))).toBeUndefined()
  }
  expect(parsePairingLink("https://connect?url=http://localhost")).toBeUndefined()
  expect(parsePairingLink("unifia://session?id=1")).toBeUndefined()
})

test("PairingLink_OversizedCredentials_AreRejected", () => {
  expect(parsePairingLink(link("https://example.com", `&user=${"a".repeat(129)}`))).toBeUndefined()
  expect(parsePairingLink(link("https://example.com", `&pwd=${"a".repeat(513)}`))).toBeUndefined()
})

test("PairingLink_Fingerprint_RequiresDesktopSha256Format", () => {
  const fingerprint = Array.from({ length: 32 }, () => "AB").join(":")
  expect(parsePairingLink(link("https://example.com", `&fp=${fingerprint}`))?.fingerprint).toBe(fingerprint)
  expect(parsePairingLink(link("https://example.com", "&fp=invalid"))?.fingerprint).toBeNull()
})
