/* SPDX-License-Identifier: MIT */
/**
 * Shared error helpers for the streaming STT implementations.
 *
 * WHY one module: the canonical STREAM_* error knowledge must have a
 * single owner (campaign §13 / ADR-070 — stable codes, no generic
 * unknown) instead of drifting copies inside each provider.
 *
 * `codeOf` is strict: it only accepts codes from
 * `STREAMING_STT_ERROR_CODES` (or any future code passed via
 * `canonicalCodes` for extension). Anything else — including the
 * literal `"unknown"`, ad-hoc string codes, or numbers — falls
 * back to the provided fallback. This guarantees consumers and
 * diagnostics never see a free-form or `unknown` stage.
 */

import { STREAMING_STT_ERROR_CODES } from "@unifia/contracts/streaming-stt"

/** Canonical STREAM_* codes as a frozen set; any code not in this
 *  set (or in `canonicalCodes`) is rejected by `codeOf` and
 *  replaced with the caller's fallback. */
const CANONICAL_CODES: ReadonlySet<string> = new Set(Object.values(STREAMING_STT_ERROR_CODES))

/** Human-readable message of any thrown value. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Canonical STREAM_* code carried by a typed prepare/transcribe
 *  failure. `codeOf` only accepts codes from
 *  `STREAMING_STT_ERROR_CODES` (or an extension set passed via
 *  `canonicalCodes`); anything else falls back to `fallback` so
 *  consumers always see a stable taxonomy member (never `unknown`,
 *  never an arbitrary string). */
export function codeOf(
  error: unknown,
  fallback: string,
  canonicalCodes?: readonly string[],
): string {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (typeof code !== "string") return fallback
  if (CANONICAL_CODES.has(code)) return code
  if (canonicalCodes?.includes(code)) return code
  return fallback
}

/** Throw a prepare-stage failure that still carries its canonical
 *  code — the router surfaces the exact stage in its fallback
 *  reason. Refuses to throw with a non-canonical code; throws an
 *  Error with code `INVALID_ERROR_CODE` if `code` is not in the
 *  canonical set (and not in the optional extension set). */
export function raised(
  code: string,
  detail: string,
  canonicalCodes?: readonly string[],
): Error & { code: string } {
  const err = new Error(detail) as Error & { code: string }
  if (CANONICAL_CODES.has(code) || canonicalCodes?.includes(code)) {
    err.code = code
  } else {
    err.code = "STREAM_INVALID_ERROR_CODE"
  }
  return err
}
