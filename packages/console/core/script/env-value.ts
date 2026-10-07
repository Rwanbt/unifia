// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

/**
 * Renders one `KEY="value"` line for the env file that `sst secret load` reads.
 *
 * WHY the backslash comes first: the value is a JSON document that came out of
 * `sst secret list`, so it legitimately contains `\"` on its own. Escaping only
 * the quote turned that pair into `\\"`, which closes the quoted value early and
 * lets the remainder of the document be read as env-file syntax. A value ending
 * in a single trailing backslash was the same defect from the other side: the
 * backslash escaped the closing quote of the line (CodeQL
 * js/incomplete-sanitization, alerts #2, #3 and #4).
 *
 * Backslash first, quote second, and each character is escaped exactly once, so
 * the pair `\"` survives the round trip as `\\\"`.
 */
export function quoteEnvValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/** Renders a whole env file body, one `KEY=value` line per entry, in order. */
export function renderEnvFile(entries: readonly (readonly [string, string])[]): string {
  return entries.map(([key, value]) => `${key}=${quoteEnvValue(value)}`).join("\n")
}
