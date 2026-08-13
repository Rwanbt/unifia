/* SPDX-License-Identifier: MIT */

export const WORKBENCH_ALLOWED_ORIGINS = ["https://tauri.localhost", "http://ipc.localhost"] as const

export type SecurityDecision = { allowed: true; origin?: string } | { allowed: false; origin: string }

export function checkRequestOrigin(origin: string | null, allowedOrigins: readonly string[] = WORKBENCH_ALLOWED_ORIGINS): SecurityDecision {
  if (origin === null) return { allowed: true }
  return allowedOrigins.includes(origin) ? { allowed: true, origin } : { allowed: false, origin }
}

export function addSecurityHeaders(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers)
  headers.set("x-content-type-options", "nosniff")
  headers.set("referrer-policy", "no-referrer")
  headers.set("cross-origin-resource-policy", "same-origin")
  if (origin) {
    headers.set("access-control-allow-origin", origin)
    headers.set("access-control-allow-credentials", "true")
    headers.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS")
    headers.set("access-control-allow-headers", "authorization,content-type,last-event-id,x-unifia-file-session,x-idempotency-key")
    headers.set("access-control-max-age", "600")
    headers.set("vary", "origin")
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
