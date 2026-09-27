/* SPDX-License-Identifier: MIT */
/**
 * Shared error helpers for the streaming STT implementations.
 *
 * WHY one module: the canonical STREAM_* error knowledge must have a
 * single owner (campaign §13 / ADR-070 — stable codes, no generic
 * unknown) instead of drifting copies inside each provider.
 */

/** Human-readable message of any thrown value. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Canonical STREAM_* code carried by a typed prepare/transcribe
 *  failure; `fallback` covers untyped programmer errors so consumers
 *  always see a stable taxonomy member (never `unknown`). */
export function codeOf(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === "string" && code.startsWith("STREAM_") ? code : fallback
}

/** Throw a prepare-stage failure that still carries its canonical
 *  code — the router surfaces the exact stage in its fallback reason. */
export function raised(code: string, detail: string): Error & { code: string } {
  const err = new Error(detail) as Error & { code: string }
  err.code = code
  return err
}
