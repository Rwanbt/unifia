/* SPDX-License-Identifier: MIT */
/**
 * Who may read the memory vault through the HTTP routes.
 *
 * The owner is the operator of this installation, and only a verified principal can be the owner:
 *
 * - With credentials configured (`UNIFIA_SERVER_PASSWORD`), the owner is a request the server
 *   authenticated as `admin`: the Basic password of the operator, or an access token of an admin.
 *   The desktop application authenticates its own sidecar this way, so it needs no cloud account.
 * - Without credentials, the server accepts requests without a principal. Only then is a request
 *   from the loopback interface taken as the local operator. A request from any other address is
 *   refused: an unsecured server is not a reason to read the vault for a stranger.
 *
 * A verified principal of another role is refused even on loopback. An unknown address is refused.
 * Nothing here trusts a request header to say that its sender is the owner.
 */
import path from "node:path"

export type OwnerRefusal = "insufficient-role" | "unauthenticated" | "remote-unsecured"

export type OwnerDecision =
  | { owner: true; via: "admin" | "local" }
  | { owner: false; refusal: OwnerRefusal }

export interface OwnerRequest {
  /** The principal the server verified for this request, if any. */
  user: { role: string } | undefined
  /** True when the server requires credentials (`UNIFIA_SERVER_PASSWORD` is set). */
  passwordConfigured: boolean
  /** Address of the TCP peer, or null when the server cannot tell. */
  clientAddress: string | null
}

const LOOPBACK_ADDRESS = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/

export function isLoopbackAddress(address: string | null): boolean {
  return address !== null && LOOPBACK_ADDRESS.test(address)
}

export function decideOwner(request: OwnerRequest): OwnerDecision {
  if (request.user !== undefined) {
    return request.user.role === "admin"
      ? { owner: true, via: "admin" }
      : { owner: false, refusal: "insufficient-role" }
  }
  if (request.passwordConfigured) return { owner: false, refusal: "unauthenticated" }
  return isLoopbackAddress(request.clientAddress)
    ? { owner: true, via: "local" }
    : { owner: false, refusal: "remote-unsecured" }
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
