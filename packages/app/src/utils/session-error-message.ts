/* SPDX-License-Identifier: MIT */

/**
 * The readable message of a session error. Server errors arrive as a named
 * error object (`{ name, data: { message } }`), not a string, so the plugin or
 * provider that failed was hidden behind the generic fallback.
 */
export function sessionErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string") return error || undefined
  if (!error || typeof error !== "object") return undefined
  const data = (error as { data?: { message?: unknown } }).data
  return typeof data?.message === "string" && data.message ? data.message : undefined
}
