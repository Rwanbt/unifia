/* SPDX-License-Identifier: MIT */

const BYTE_VALUES = 256

/**
 * Random string over `alphabet`, uniform: `byte % alphabet.length` favours the
 * first `256 % length` characters, so bytes past the last whole multiple are
 * dropped and redrawn instead of folded in (CodeQL js/biased-cryptographic-random).
 * Used for ids and OAuth PKCE verifiers, where predictability matters.
 */
export function randomString(alphabet: string, length: number, fill: (bytes: Uint8Array) => void = fillRandom): string {
  if (alphabet.length < 2 || alphabet.length > BYTE_VALUES) throw new RangeError("alphabet must hold 2 to 256 characters")
  const limit = BYTE_VALUES - (BYTE_VALUES % alphabet.length)
  const bytes = new Uint8Array(Math.max(length * 2, 16))
  let out = ""
  while (out.length < length) {
    fill(bytes)
    for (const byte of bytes) {
      if (byte >= limit) continue
      out += alphabet[byte % alphabet.length]
      if (out.length === length) break
    }
  }
  return out
}

function fillRandom(bytes: Uint8Array): void {
  crypto.getRandomValues(bytes)
}
