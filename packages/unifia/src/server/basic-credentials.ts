/* SPDX-License-Identifier: MIT */

import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Whether the credentials in a `Basic` authorization value (the part after `Basic `) are the operator's.
 *
 * The user name ends at the first colon (RFC 7617), so a password may itself contain colons. Both fields are
 * compared as SHA-256 digests in constant time: a mismatch reveals neither the secret's length nor a prefix of it.
 */
export function basicCredentialsMatch(encoded: string, expectedUser: string, expectedPassword: string): boolean {
  const decoded = Buffer.from(encoded, "base64").toString("utf8")
  const separator = decoded.indexOf(":")
  if (separator === -1) return false
  const user = decoded.slice(0, separator)
  const password = decoded.slice(separator + 1)
  const userMatches = digestsEqual(user, expectedUser)
  const passwordMatches = digestsEqual(password, expectedPassword)
  return userMatches && passwordMatches
}

function digestsEqual(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected))
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest()
}
