/* SPDX-License-Identifier: MIT */
/**
 * Which browser origins may call this server, and which browser requests it refuses.
 *
 * CORS only decides whether a page may read a response. It does not stop the request from running, and a
 * browser attaches credentials it already holds (a cached Basic login) to requests from any page. So the
 * server refuses a cross-origin browser request itself, and CORS only adds the headers for origins it trusts.
 *
 * A request with no Origin and no Fetch Metadata comes from a native or command-line client. It still needs
 * credentials (the auth middleware checks them), and no browser can attach them for it.
 */

/** The desktop app's own origins: the packaged webview on each platform. */
export const NATIVE_APP_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"] as const

/**
 * The desktop app's dev server. packages/desktop/vite.config.ts serves on this port, and tauri.conf.json's
 * devUrl loads it as `localhost`, so the webview's origin is this exact value.
 */
export const DESKTOP_DEV_ORIGINS = ["http://localhost:1420"] as const

export class InvalidOriginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidOriginError"
  }
}

/**
 * An exact http(s) origin: scheme, host and optional port. Anything else is refused: a wildcard, a path,
 * a query, a fragment, user information, or a scheme the browser would not send as an origin.
 */
export function parseAllowedOrigin(raw: string): string {
  if (raw.includes("*")) throw new InvalidOriginError(`wildcards are not allowed in an origin: ${raw}`)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new InvalidOriginError(`not an origin: ${raw}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new InvalidOriginError(`origin must be http or https: ${raw}`)
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new InvalidOriginError(`an origin has no path, query, fragment or user information: ${raw}`)
  }
  if (url.origin !== raw.replace(/\/$/, "")) throw new InvalidOriginError(`not an origin: ${raw}`)
  return url.origin
}

/** The origins a server trusts: the native app's, the desktop dev server's, and those explicitly configured. */
export function allowedBrowserOrigins(configured: readonly string[] = []): readonly string[] {
  const trusted = new Set<string>([...NATIVE_APP_ORIGINS, ...DESKTOP_DEV_ORIGINS])
  for (const origin of configured) trusted.add(parseAllowedOrigin(origin))
  return [...trusted]
}

export type BrowserRequestRefusal = "untrusted-origin" | "cross-site-request"

/**
 * The reason a browser request must be refused, or undefined when it may proceed to authentication.
 *
 * `sameOrigin` is the origin the request was addressed to. A request whose Origin is that origin came from
 * a page on the server itself, which is trusted. Fetch Metadata is a second signal for browsers that send
 * it without an Origin, and it is never enough on its own: a cross-site or same-site request must come
 * from a trusted origin too.
 */
export function refuseBrowserRequest(input: {
  readonly origin: string | null
  readonly secFetchSite: string | null
  readonly sameOrigin: string
  readonly allowed: readonly string[]
}): BrowserRequestRefusal | undefined {
  const trusted = input.origin !== null && (input.origin === input.sameOrigin || input.allowed.includes(input.origin))
  if (input.origin !== null && !trusted) return "untrusted-origin"
  if ((input.secFetchSite === "cross-site" || input.secFetchSite === "same-site") && !trusted) return "cross-site-request"
  return undefined
}
