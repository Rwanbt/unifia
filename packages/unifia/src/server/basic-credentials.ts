/* SPDX-License-Identifier: MIT */

import { timingSafeEqual } from "node:crypto"

/**
 * Whether the credentials in a `Basic` authorization value (the part after `Basic `) are the operator's.
 *
 * The user name ends at the first colon (RFC 7617), so a password may itself contain colons. Both fields are
 * compared in constant time: the bytes of a mismatch are never read in an order that reveals a prefix.
 */
export function basicCredentialsMatch(encoded: string, expectedUser: string, expectedPassword: string): boolean {
  const decoded = Buffer.from(encoded, "base64").toString("utf8")
  const separator = decoded.indexOf(":")
  if (separator === -1) return false
  const user = decoded.slice(0, separator)
  const password = decoded.slice(separator + 1)
  const userMatches = sameText(user, expectedUser)
  const passwordMatches = sameText(password, expectedPassword)
  return userMatches && passwordMatches
}

/**
 * Compares two strings in constant time without hashing them: a fast digest of a password is what static analysis
 * flags, and a memory-hard one would cost every request. Both values are padded to the longer length before the byte
 * comparison, so the comparison visits every byte of both. Whether the lengths differ is checked after it.
 */
function sameText(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, "utf8")
  const expectedBytes = Buffer.from(expected, "utf8")
  const size = Math.max(candidateBytes.length, expectedBytes.length)
  const paddedCandidate = Buffer.alloc(size)
  const paddedExpected = Buffer.alloc(size)
  candidateBytes.copy(paddedCandidate)
  expectedBytes.copy(paddedExpected)
  const bytesMatch = timingSafeEqual(paddedCandidate, paddedExpected)
  return bytesMatch && candidateBytes.length === expectedBytes.length
}
