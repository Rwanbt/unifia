/**
 * The central authorization boundary of the sidecar's HTTP API.
 *
 * Every request passes here once its principal is verified (JwtAuth) and before any route runs. The decision reads three
 * things: the action class of the route (route-classes.ts), the level of the verified principal, and the minimum level the
 * class needs (the one table below). A route with no class is refused for every caller (default deny). A refusal names
 * nothing: it is the same fixed answer whatever the route, the class or the directory.
 *
 * Levels, lowest first: viewer, member, admin, owner. The owner is the principal isOwnerPrincipal accepts: the operator's
 * basic credential, in the admin role. An admin access token is level admin, not the owner.
 *
 * When no password is configured, a request that carries no principal is answered as it was before this boundary: the
 * no-password mode is the operator's own decision and is not changed here. Any request that carries a verified principal
 * is judged by its level, password or not.
 */

import type { MiddlewareHandler } from "hono"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"
import { isOwnerPrincipal, principalOf, type VerifiedPrincipal } from "./auth-jwt"
import { ownDirectory, requestedDirectory } from "./request-directory"
import { ROUTE_CLASSES, type ActionClass, type RouteMethod } from "./route-classes"

const log = Log.create({ service: "route-authz" })

const LEVELS = ["viewer", "member", "admin", "owner"] as const
export type Level = (typeof LEVELS)[number]

/**
 * The one table: the lowest level that may perform each action class. A level performs every class whose minimum it
 * reaches. A viewer reads the project's data. A member also writes it and chats. An administrator also manages accounts,
 * telemetry and the repository's worktrees. The owner alone runs processes, changes credentials and changes configuration.
 */
const MINIMUM_LEVEL: Record<Exclude<ActionClass, "public">, Level> = {
  "read-metadata": "viewer",
  "read-content": "viewer",
  "write-content": "member",
  admin: "admin",
  diagnostic: "admin",
  execute: "owner",
  credential: "owner",
  config: "owner",
}

/** The one answer a refused request receives. It names no route, class, directory or secret. */
export const REFUSAL = { error: "Not authorized for this action" } as const

/** The level of a verified principal, or undefined for a role the table does not know. */
export function levelOf(principal: VerifiedPrincipal): Level | undefined {
  if (isOwnerPrincipal(principal)) return "owner"
  if (principal.role === "admin" || principal.role === "member" || principal.role === "viewer") return principal.role
  return undefined
}

/** Whether a level performs an action class. */
export function levelPerforms(level: Level, action: Exclude<ActionClass, "public">): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(MINIMUM_LEVEL[action])
}

function methodMatches(entry: RouteMethod, method: string): boolean {
  if (entry === "ALL") return true
  if (method === "HEAD") return entry === "GET"
  return entry === method
}

function segmentsMatch(pattern: string, path: string): boolean {
  const wanted = pattern.split("/")
  const actual = path.split("/")
  if (wanted.length !== actual.length) return false
  return wanted.every((segment, index) => (segment.startsWith(":") ? actual[index] !== "" : segment === actual[index]))
}

function wildcardMatches(pattern: string, path: string): boolean {
  return path.startsWith(pattern.slice(0, -1))
}

function literalSegments(pattern: string): number {
  return pattern.split("/").filter((segment) => segment !== "" && !segment.startsWith(":")).length
}

// Exact entries are tried before the wildcard entries, so a wildcard never answers for a route that has its own entry.
// Among exact entries the most literal pattern is tried first, as the router does: GET /debate/config is not GET /debate/:id.
const EXACT_ENTRIES = ROUTE_CLASSES.filter(([, path]) => !path.endsWith("/*")).sort(
  ([, a], [, b]) => literalSegments(b) - literalSegments(a),
)
const WILDCARD_ENTRIES = ROUTE_CLASSES.filter(([, path]) => path.endsWith("/*"))

/**
 * The embedded web interface: the root page and its static files. A GET for one of these is answered by the interface,
 * which holds no data. Any other GET with no entry is a route the registry does not name, and it is refused.
 */
function isEmbeddedInterfacePath(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false
  if (path === "/") return true
  return /\/[^/]+\.[A-Za-z0-9]+$/.test(path)
}

/** The action class of a request, or undefined when no entry covers it (default deny). */
export function actionClassOf(method: string, path: string): ActionClass | undefined {
  const exact = EXACT_ENTRIES.find(([entry, pattern]) => methodMatches(entry, method) && segmentsMatch(pattern, path))
  if (exact) return exact[2]
  const wildcard = WILDCARD_ENTRIES.find(([entry, pattern]) => methodMatches(entry, method) && wildcardMatches(pattern, path))
  if (wildcard) return wildcard[2]
  return isEmbeddedInterfacePath(method, path) ? "public" : undefined
}

export interface AuthorizationInput {
  method: string
  path: string
  principal: VerifiedPrincipal | undefined
  passwordConfigured: boolean
  /** The directory the request names, resolved, or undefined when it names none. */
  directory: string | undefined
  /** Whether the request selects a workspace, which is a directory of its own. */
  workspace: boolean
  /** The server's own project directory: the one a request gets when it names no directory. */
  ownDirectory: string
}

/**
 * A caller other than the owner works in the server's own project directory. Another directory, named by the query or
 * the header, and a workspace, which selects one, are refused. The rule is the owner's: an admin account gets no more.
 */
function namesOnlyOwnDirectory(input: AuthorizationInput): boolean {
  if (input.workspace) return false
  return input.directory === undefined || input.directory === input.ownDirectory
}

/** Whether the request may reach its route. */
export function authorize(input: AuthorizationInput): boolean {
  const action = actionClassOf(input.method, input.path)
  if (action === undefined) return false
  if (action === "public") return true
  if (input.principal === undefined) return !input.passwordConfigured
  const level = levelOf(input.principal)
  if (level === undefined || !levelPerforms(level, action)) return false
  return level === "owner" || namesOnlyOwnDirectory(input)
}

/** The boundary as a middleware of the control-plane application. */
export function routeAuthorization(): MiddlewareHandler {
  return async (c, next) => {
    // A preflight is answered by the CORS layer, and carries no credential.
    if (c.req.method === "OPTIONS") return next()
    const allowed = authorize({
      method: c.req.method,
      path: c.req.path,
      principal: principalOf(c.req.raw),
      passwordConfigured: Boolean(Flag.UNIFIA_SERVER_PASSWORD),
      directory: requestedDirectory(c),
      workspace: Boolean(c.req.query("workspace")),
      ownDirectory: ownDirectory(),
    })
    if (allowed) return next()
    log.warn("request refused", { method: c.req.method, path: c.req.path })
    return c.json(REFUSAL, 403)
  }
}
