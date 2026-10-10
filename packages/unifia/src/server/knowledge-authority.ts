/* SPDX-License-Identifier: MIT */
/**
 * Who may read the memory vault through the HTTP routes.
 *
 * Only a verified principal of role `admin` is the owner. The server verifies it: the operator's
 * credentials (`UNIFIA_SERVER_PASSWORD`, which the desktop application uses for its own sidecar, so
 * no cloud account is needed) or an access token of an admin. Nothing else is the owner:
 *
 * - The loopback interface is not an identity. Any program on the machine, and any web page that a
 *   browser lets reach a local port, comes from loopback. A request without a verified admin
 *   principal is refused, with or without credentials configured.
 * - A request must also target this server as the application does. A browser page can reach a
 *   local server through a name it controls (DNS rebinding), or send a request from another origin.
 *   The `Host` must be `localhost` or an IP literal, and an `Origin`, when present, must be an
 *   origin of the application. A request without an `Origin` comes from a native client.
 */
import path from "node:path"

export type OwnerRefusal = "insufficient-role" | "unauthenticated"

export type OwnerDecision = { owner: true; via: "admin" } | { owner: false; refusal: OwnerRefusal }

/** The identity the server verified for the request, if any. */
export interface OwnerRequest {
  user: { role: string } | undefined
}

export function decideOwner(request: OwnerRequest): OwnerDecision {
  if (request.user === undefined) return { owner: false, refusal: "unauthenticated" }
  return request.user.role === "admin"
    ? { owner: true, via: "admin" }
    : { owner: false, refusal: "insufficient-role" }
}

/** Origins the application itself runs from: the desktop webviews and the development server. */
const APPLICATION_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
]

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/

/** A `Host` that is loopback or an IP literal. A host name is refused: it is the way DNS rebinding reaches the server. */
function isTrustedHost(host: string): boolean {
  if (host.startsWith("[")) return host.includes("]") // IPv6 literal, with or without a port
  const name = host.replace(/:\d+$/, "")
  return name === "localhost" || IPV4_LITERAL.test(name)
}

export interface RequestTarget {
  /** The `Host` header, or null when absent. */
  host: string | null
  /** The `Origin` header, or null when the request has none. */
  origin: string | null
  /** The port this server listens on, when known. */
  serverPort: number | undefined
}

/** True when the request targets this server as the application does (see the module comment). */
export function isTrustedRequestTarget(target: RequestTarget): boolean {
  if (target.host === null || !isTrustedHost(target.host)) return false
  if (target.origin === null) return true
  if (APPLICATION_ORIGINS.includes(target.origin)) return true
  if (target.serverPort === undefined) return false
  return [
    `http://127.0.0.1:${target.serverPort}`,
    `http://localhost:${target.serverPort}`,
    `http://[::1]:${target.serverPort}`,
  ].includes(target.origin)
}

/** True when `child` is `parent` or lies inside it. Both must be resolved (real) paths. */
export function isInsideDirectory(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  if (relative === "") return true
  if (path.isAbsolute(relative)) return false
  return relative !== ".." && !relative.startsWith(`..${path.sep}`)
}

/**
 * The default vault resolves inside its project. A vault whose real location lies outside the
 * project, through a symbolic link or a junction, is refused before anything is read from it.
 * A location the owner configured explicitly is the owner's own choice, and is not checked here.
 */
export class VaultLocationRefused extends Error {
  constructor() {
    super("memory vault location is outside its project")
    this.name = "VaultLocationRefused"
  }
}
