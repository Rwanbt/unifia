/* SPDX-License-Identifier: MIT */
// Pure helpers for the Toolchains & containers settings section. They hold no UI state, so the parsing
// and the error text can be tested without the SDK or the DOM.

const PACKAGE_SEPARATOR = /[\s,]+/

// The server validates each name against the Alpine pattern; splitting here only spares a round trip for typos.
export function splitPackageNames(input: string): string[] {
  const names = input
    .split(PACKAGE_SEPARATOR)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  return [...new Set(names)]
}

// The server answers refusals as { name, data: { message } } and throws as Error; anything else is shown as is.
export function errorMessage(error: unknown): string {
  // An Error inherits a `name` ("Error"), so its own message must be checked before the name fallback.
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const data = (error as { data?: { message?: unknown } }).data
    if (typeof data?.message === "string") return data.message
    const name = (error as { name?: unknown }).name
    if (typeof name === "string") return name
  }
  return String(error)
}
