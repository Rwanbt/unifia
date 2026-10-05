/* SPDX-License-Identifier: MIT */

export type BrowserHistoryAction = "back" | "forward" | "reload"

export type BrowserNavigationRequest = { url: string; requestId: string }

export type BrowserHandoffState = { browserInitialUrl: string; browserInitialRequestId: string }

/**
 * The history state another surface (Design's Browser tab) attaches when it
 * opens the Browser destination at an address. `browserNavigationRequest` is
 * its only reader, so the two keys are owned here rather than spelled at the
 * call site. `undefined` when the address is not one the Browser may open.
 */
export function browserHandoffState(address: string, requestId: string): BrowserHandoffState | undefined {
  const url = normalizeBrowserAddress(address)
  return url && requestId ? { browserInitialUrl: url, browserInitialRequestId: requestId } : undefined
}

export function browserNavigationRequest(state: unknown): BrowserNavigationRequest | undefined {
  if (!state || typeof state !== "object" || !("browserInitialUrl" in state) || !("browserInitialRequestId" in state)) return
  const value = state as { browserInitialUrl: unknown; browserInitialRequestId: unknown }
  if (typeof value.browserInitialUrl !== "string" || typeof value.browserInitialRequestId !== "string" || !value.browserInitialRequestId) return
  const url = normalizeBrowserAddress(value.browserInitialUrl)
  return url ? { url, requestId: value.browserInitialRequestId } : undefined
}

export function shouldSyncBrowserAddress(
  previous: { tabId?: string; url?: string },
  next: { tabId?: string; url?: string },
): boolean {
  return previous.tabId !== next.tabId || previous.url !== next.url
}

/**
 * Phase 14 — turns what the user typed into an address the native side will
 * accept, or nothing.
 *
 * The Rust command refuses any scheme other than http(s) (windows.rs), so a
 * bare host has to be promoted rather than passed through. Returning "" for
 * input the host would reject keeps the refusal on this side, where the tab
 * can explain it, instead of surfacing a Rust error string.
 */
export function normalizeBrowserAddress(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return ""
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return ""
  // A scheme with no host ("https://") parses, but names no page to open.
  if (!parsed.hostname) return ""
  return parsed.toString()
}

const MAX_VISITED = 50

/** Most recent first, one entry per address, capped: the session's opened pages. */
export function rememberVisited(visited: readonly string[], address: string): readonly string[] {
  return [address, ...visited.filter((entry) => entry !== address)].slice(0, MAX_VISITED)
}

/** Short row label for an address: host and path, without scheme or trailing slash. */
export function visitedLabel(address: string): string {
  try {
    const parsed = new URL(address)
    return `${parsed.host}${parsed.pathname}`.replace(/\/$/, "")
  } catch {
    return address
  }
}
