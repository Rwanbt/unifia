/* SPDX-License-Identifier: MIT */
/**
 * Who may read the memory vault through the HTTP routes.
 *
 * Only the operator is the owner: a request authenticated by the operator's own basic credential
 * (`UNIFIA_SERVER_PASSWORD`, which the desktop application uses for its own sidecar, so no cloud
 * account is needed), in the admin role. Nothing else is the owner:
 *
 * - An access token of an admin account is a verified admin principal, but it is not the owner, and
 *   neither is a WebSocket ticket. The owner's authority is the operator's credential alone.
 * - The loopback interface is not an identity. Any program on the machine, and any web page that a
 *   browser lets reach a local port, comes from loopback. A request without the operator's verified
 *   credential is refused, with or without credentials configured.
 * - A request must also target this server as the application does. A browser page can reach a
 *   local server through a name it controls (DNS rebinding), or send a request from another origin.
 *   The `Host` must be `localhost` or an IP literal, and an `Origin`, when present, must be an
 *   origin of the application. A request without an `Origin` comes from a native client.
 */
import path from "node:path"
import { existsSync, realpathSync } from "node:fs"
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os"
import { resolveMemoryRoot } from "../knowledge/app/memory"
import { isOwnerPrincipal, type VerifiedPrincipal } from "./auth-jwt"

export type OwnerRefusal = "not-operator" | "unauthenticated"

export type OwnerDecision = { owner: true; via: "operator" } | { owner: false; refusal: OwnerRefusal }

/** The identity the server verified for the request, if any. */
export interface OwnerRequest {
  user: VerifiedPrincipal | undefined
}

/** Only the operator's basic credential, in the admin role, is the owner (see `isOwnerPrincipal`). */
export function decideOwner(request: OwnerRequest): OwnerDecision {
  if (request.user === undefined) return { owner: false, refusal: "unauthenticated" }
  return isOwnerPrincipal(request.user)
    ? { owner: true, via: "operator" }
    : { owner: false, refusal: "not-operator" }
}

/** Origins the application itself runs from: the desktop webviews and the development server. */
const APPLICATION_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
]

/** A dotted-quad IPv4 address: four octets 0-255, no leading zeros, so `127.0.0.01` is not accepted. */
const IPV4_ADDRESS = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** The `Host` split into its address and port. Null when it is not a host with an optional port. */
function parseHost(host: string): { address: string; port: number | undefined } | null {
  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::(\d{1,5}))?$/.exec(host)
  const plain = bracketed ? null : /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(host)
  const match = bracketed ?? plain
  if (match === null) return null
  return {
    address: match[1]!.toLowerCase(),
    port: match[2] === undefined ? undefined : Number(match[2]),
  }
}

/**
 * An address this server may be reached at: `localhost`, the loopback block 127.0.0.0/8 and IPv6
 * `::1`, or an address this machine actually has on one of its interfaces. Any other IP literal, and
 * any host name, is refused: a host name is how DNS rebinding reaches a local server.
 */
function isTrustedAddress(address: string, localAddresses: ReadonlySet<string>): boolean {
  if (address === "localhost") return true
  if (IPV4_ADDRESS.test(address)) return address.startsWith("127.") || localAddresses.has(address)
  if (address.includes(":")) return address === "::1" || localAddresses.has(address)
  return false
}

/** The addresses this machine answers on: every interface address, loopback included. */
export function machineAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): ReadonlySet<string> {
  const addresses = new Set<string>()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) addresses.add(entry.address.toLowerCase())
  }
  return addresses
}

export interface RequestTarget {
  /** The `Host` header, or null when absent. */
  host: string | null
  /** The `Origin` header, or null when the request has none. */
  origin: string | null
  /** The port this server listens on. */
  serverPort: number | undefined
  /** The addresses this machine answers on (see `machineAddresses`). */
  localAddresses: ReadonlySet<string>
}

function serverOrigins(port: number): readonly string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]
}

/**
 * True when the request targets this server as the application does (see the module comment): the
 * `Host` is this machine on this server's port, and the `Origin`, when there is one, is an origin of
 * the application.
 */
export function isTrustedRequestTarget(target: RequestTarget): boolean {
  if (target.serverPort === undefined || target.host === null) return false
  const host = parseHost(target.host)
  if (host === null || host.port !== target.serverPort) return false
  if (!isTrustedAddress(host.address, target.localAddresses)) return false
  if (target.origin === null) return true
  if (APPLICATION_ORIGINS.includes(target.origin)) return true
  return serverOrigins(target.serverPort).includes(target.origin)
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

/**
 * Refuse a default vault that resolves outside its project. The application and the CLI both call
 * this, so one directory is refused the same way whichever surface opens it.
 */
export function assertDefaultVaultInside(worktree: string): void {
  const root = resolveMemoryRoot(worktree)
  if (!existsSync(root)) return
  // Real paths on both sides: a symbolic link or a junction inside the project cannot point the vault elsewhere.
  if (!isInsideDirectory(realpathSync(root), realpathSync(worktree))) throw new VaultLocationRefused()
}
