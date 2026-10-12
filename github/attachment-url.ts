// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

/**
 * The image download in `getUserPrompt()` reads its URLs out of a prompt that a
 * model produced, and every one of those requests carries the Action's GitHub
 * token. Two things therefore have to hold before the header is built.
 *
 * 1. The URL is pinned to the one host the token is meant for. The surrounding
 *    regex only ever matches text that starts with the literal
 *    `https://github.com/user-attachments/`, so the host cannot be swapped by
 *    the string alone, but a regex is a filter on text and not on a parsed URL:
 *    it never sees what `new URL()` resolves, and it has no answer for a
 *    redirect. Asserting the parsed origin closes that gap instead of assuming
 *    it (CodeQL js/request-forgery, alert #14).
 *
 * 2. Nothing derived from the prompt is written to a log verbatim. A URL can
 *    carry CR and LF, and a forged line in a workflow log is how a caller turns
 *    a diagnostic into a misleading record (CodeQL js/log-injection, alert #23).
 */

/** The only origin the Action's token is ever sent to. */
export const ATTACHMENT_ORIGIN = "https://github.com"

/** The only path prefix the Action serves attachments from. */
const ATTACHMENT_PREFIX = "/user-attachments/"

/**
 * Returns the parsed URL when it is a GitHub user-attachment URL, else `null`.
 *
 * `null` means "do not fetch this", not "fetch it anyway": the caller drops the
 * match, so a prompt cannot steer the token to another origin by any encoding.
 */
export function attachmentUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null
  if (url.origin !== ATTACHMENT_ORIGIN) return null
  if (!url.pathname.startsWith(ATTACHMENT_PREFIX)) return null
  return url
}

/**
 * Flattens untrusted text into one bounded log line: CR, LF and TAB become
 * spaces, control characters are dropped, and the result is truncated so a long
 * prompt cannot push the real message off the end of the line.
 */
export function logSafe(value: string, max = 200): string {
  const flattened = value.replace(/[\x00-\x1f\x7f]+/g, " ").trim()
  return flattened.length > max ? `${flattened.slice(0, max)}...` : flattened
}
