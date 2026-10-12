/* SPDX-License-Identifier: MIT */

import { createHash } from "node:crypto"
import z from "zod"
import { NamedError } from "@unifia/util/error"

export const ChecksumMismatchError = NamedError.create(
  "ChecksumMismatchError",
  z.object({
    name: z.string(),
    expected: z.string(),
    actual: z.string(),
  }),
)

// Callers run this before the bytes reach disk or an extractor.
export function assertSha256(bytes: ArrayBuffer, expected: string, name: string): void {
  const actual = createHash("sha256").update(new Uint8Array(bytes)).digest("hex")
  if (actual !== expected) throw new ChecksumMismatchError({ name, expected, actual })
}
