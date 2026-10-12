/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { deriveWorkbenchSigningKey } from "../../src/server/workbench"

describe("deriveWorkbenchSigningKey", () => {
  test("is deterministic, 32 bytes of hex", () => {
    const key = deriveWorkbenchSigningKey("a-generated-password-0123456789")
    expect(key).toBe(deriveWorkbenchSigningKey("a-generated-password-0123456789"))
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  test("differs for different passwords", () => {
    expect(deriveWorkbenchSigningKey("password-one-0123456789")).not.toBe(deriveWorkbenchSigningKey("password-two-0123456789"))
  })

  test("is not the bare SHA-256 of the password any more", () => {
    const password = "a-generated-password-0123456789"
    expect(deriveWorkbenchSigningKey(password)).not.toBe(createHash("sha256").update(password, "utf8").digest("hex"))
  })

  test("costs work on every guess (a fast hash would take well under a millisecond)", () => {
    const start = performance.now()
    for (let attempt = 0; attempt < 3; attempt++) deriveWorkbenchSigningKey(`guess-${attempt}`)
    expect(performance.now() - start).toBeGreaterThan(3)
  })
})
