// SPDX-License-Identifier: MIT

// Splits an already-validated toolchain command into an argv, so it can be run
// without a shell. `cargo-proxy.mjs` refuses every shell control character
// before this is reached; what remains is whitespace separation and quotes, so
// `cargo test -- "a b"` keeps `a b` as one argument.

/**
 * @param {string} command
 * @returns {string[]} the tokens, or [] when a quote is left open
 */
export function splitCommand(command) {
  const tokens = []
  let current = ""
  let quote = null
  let started = false
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current)
      current = ""
      started = false
      continue
    }
    current += char
    started = true
  }
  if (quote) return []
  if (started) tokens.push(current)
  return tokens
}
