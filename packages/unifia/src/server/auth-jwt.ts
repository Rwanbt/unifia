import { createHmac, randomBytes } from "node:crypto"
import type { Context, Next } from "hono"
import { HTTPException } from "hono/http-exception"
import { User, type UserID, type UserRole } from "../user"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { basicCredentialsMatch } from "./basic-credentials"

const log = Log.create({ service: "auth-jwt" })

/**
 * How the server verified the principal: the operator's basic credential, an access token (Bearer), or a WebSocket ticket.
 * The owner's authority is the basic credential alone (ADR-094), so the route that grants it must know which one was presented.
 */
export type PrincipalVia = "basic" | "bearer" | "ws-ticket"

/** The identity the server verified for one request. */
export interface VerifiedPrincipal {
  id: string
  username: string
  role: UserRole
  via: PrincipalVia
}

/**
 * Whether the verified principal is the owner: authenticated by the operator's own basic credential, in the admin role.
 * The code records no owner identity. A JWT carries the account's role and nothing that marks its owner, so an access token
 * of any admin account, and a WebSocket ticket, are not the owner, whatever their role.
 */
export function isOwnerPrincipal(principal: VerifiedPrincipal | undefined): boolean {
  return principal?.via === "basic" && principal.role === "admin"
}

/**
 * The verified principal of each request, keyed by the request object itself.
 *
 * `c.set` binds a value to the context of the outer app only: the instance router replays the same
 * `Request` into a new app, where that value is absent. The request object is what the two apps
 * share, so the principal travels with it. Nothing here reads a header a client could forge.
 */
const verifiedPrincipals = new WeakMap<Request, VerifiedPrincipal>()

export function bindPrincipal(c: Context, principal: VerifiedPrincipal): void {
  c.set("user", principal)
  verifiedPrincipals.set(c.req.raw, principal)
}

export function principalOf(request: Request): VerifiedPrincipal | undefined {
  return verifiedPrincipals.get(request)
}

export namespace JwtAuth {
  // The process secret. It is fixed once a token has been signed with it: a token that verified keeps verifying for as
  // long as the process runs.
  let _secret: string | undefined

  /**
   * Load the configured secret. The server calls this once, before it listens, so no token exists yet when the secret
   * could change. Only the user's global configuration is read: the process secret belongs to the machine, and a
   * project's own configuration, which a cloned repository controls, must not be able to choose it. The configuration
   * loader logs a global file it cannot read and treats it as absent, so an unreadable file leaves the generated
   * secret in place: check the log when several instances must share one.
   *
   * Without a configured secret the process generates its own on first use. Its tokens do not survive a restart, and
   * two processes never accept each other's tokens: several instances need `experimental.collaborative.jwt_secret`.
   */
  export async function init(): Promise<void> {
    const configured = (await Config.getGlobal())?.experimental?.collaborative?.jwt_secret
    if (configured) {
      _secret = configured
      log.info("using the configured JWT secret")
    }
  }

  function getSecret(): string {
    if (!_secret) {
      _secret = randomBytes(32).toString("hex")
      log.info("auto-generated JWT secret (not persisted)")
    }
    return _secret
  }

  export interface TokenPayload {
    sub: string // UserID
    username: string
    role: UserRole
    iat: number
    exp: number
  }

  const ACCESS_TOKEN_TTL = 15 * 60 * 1000 // 15 minutes

  function base64url(data: string | Buffer): string {
    const buf = typeof data === "string" ? Buffer.from(data) : data
    return buf.toString("base64url")
  }

  function sign(payload: object, secret: string): string {
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const body = base64url(JSON.stringify(payload))
    const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
    return `${header}.${body}.${signature}`
  }

  function verify(token: string, secret: string): TokenPayload | null {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const [header, body, signature] = parts
    const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
    if (signature !== expected) return null

    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload
      if (payload.exp && payload.exp < Date.now()) return null
      return payload
    } catch {
      return null
    }
  }

  export function issue(user: User.Info): { accessToken: string; refreshToken: string } {
    const now = Date.now()
    const payload: TokenPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
    }
    const accessToken = sign(payload, getSecret())
    const refreshToken = User.Token.create(user.id as UserID)
    return { accessToken, refreshToken }
  }

  export function refresh(refreshToken: string): { accessToken: string; refreshToken: string } | null {
    const userId = User.Token.verify(refreshToken)
    if (!userId) return null

    // Revoke old refresh token (rotation)
    User.Token.revoke(refreshToken)

    const user = User.get(userId)
    if (!user) return null

    return issue(user)
  }

  // ───── WS ticket (B2, Sprint 4) ──────────────────────────────────────────
  // Short-lived JWT (60s) intended to be set as an HttpOnly cookie on
  // /auth/ws-ticket so that the WebSocket upgrade handshake can authenticate
  // via cookie (always sent) OR via Sec-WebSocket-Protocol "bearer,<jwt>"
  // (preferred — no cookie jar pollution). This replaces the legacy
  // `?authorization=Bearer+<jwt>` query string which leaks into access logs.
  const WS_TICKET_TTL = 60 * 1000 // 60 s

  export interface WsTicketPayload extends TokenPayload {
    /** Discriminator so ticket tokens cannot be used as access tokens. */
    kind: "ws-ticket"
  }

  export function issueWsTicket(user: { id: string; username: string; role: UserRole }): string {
    const now = Date.now()
    const payload: WsTicketPayload = {
      kind: "ws-ticket",
      sub: user.id,
      username: user.username,
      role: user.role,
      iat: now,
      exp: now + WS_TICKET_TTL,
    }
    return sign(payload, getSecret())
  }

  /** Verify a WS ticket JWT. Returns null on invalid / expired / wrong kind. */
  export function verifyWsTicket(token: string): WsTicketPayload | null {
    const payload = verify(token, getSecret())
    if (!payload) return null
    if ((payload as any).kind !== "ws-ticket") return null
    return payload as WsTicketPayload
  }

  /**
   * A WebSocket ticket is signed with the same secret, so the signature alone does not tell the two apart. The `kind`
   * marks a ticket, and a ticket never authenticates a request as an access token, whatever its lifetime.
   */
  export function verifyAccessToken(token: string): TokenPayload | null {
    const payload = verify(token, getSecret())
    if (payload === null || (payload as { kind?: unknown }).kind === "ws-ticket") return null
    return payload
  }

  /**
   * Hono middleware that supports both JWT Bearer and Basic Auth.
   * When collaborative mode is disabled, falls back to basic auth only.
   * Sets `c.set("user", ...)` when JWT auth succeeds.
   */
  export function middleware() {
    return async (c: Context, next: Next) => {
      // Allow CORS preflight
      if (c.req.method === "OPTIONS") return next()

      // Prefer the Authorization header — always safe.
      let authHeader = c.req.header("Authorization")

      // ─── B2 (Sprint 4) — WebSocket-upgrade auth ────────────────────────
      // Order of preference for WS upgrades:
      //   1. Authorization header (normal path — some clients CAN set it)
      //   2. Sec-WebSocket-Protocol: bearer,<ws-ticket-jwt>
      //      (standards-compliant; the ticket is a ws-ticket kind, 60s TTL)
      //   3. Cookie `opencode_ws_ticket=<jwt>` (HttpOnly, browser WS upgrades)
      //   4. LEGACY: ?authorization=Bearer+<jwt> (query string)
      //      — gated by experimental.ws_auth_legacy (default true for back-compat
      //        in Sprint 4, flip to false in Sprint 5 after clients migrate).
      const upgrade = c.req.header("Upgrade")?.toLowerCase()
      if (!authHeader && upgrade === "websocket") {
        // (2) Sec-WebSocket-Protocol
        const proto = c.req.header("Sec-WebSocket-Protocol")
        if (proto) {
          const parts = proto.split(",").map((s) => s.trim())
          const idx = parts.indexOf("bearer")
          if (idx >= 0 && parts[idx + 1]) {
            const ticket = verifyWsTicket(parts[idx + 1])
            if (ticket) {
              bindPrincipal(c, { id: ticket.sub, username: ticket.username, role: ticket.role, via: "ws-ticket" })
              // RFC 6455 §4.2.2: the Sec-WebSocket-Protocol response header
              // MUST contain exactly ONE subprotocol chosen from the client's
              // offered list. Echoing "bearer,<ticket>" (two values) gets
              // rejected by Chromium/WebView2 with "server selected invalid
              // subprotocol" → WS closes immediately → no prompt, no input.
              // Just echo "bearer" which was offered by the client.
              c.header("Sec-WebSocket-Protocol", "bearer")
              return next()
            }
          }
        }

        // (3) Cookie
        const cookie = c.req.header("Cookie")
        if (cookie) {
          const m = /(?:^|;\s*)opencode_ws_ticket=([^;]+)/.exec(cookie)
          if (m) {
            const ticket = verifyWsTicket(decodeURIComponent(m[1]))
            if (ticket) {
              bindPrincipal(c, { id: ticket.sub, username: ticket.username, role: ticket.role, via: "ws-ticket" })
              return next()
            }
          }
        }

        // (4) Legacy query string — opt-out via experimental.ws_auth_legacy = false.
        // Accept both Bearer <jwt> and Basic <base64>. Earlier Sprint-4 code
        // only accepted Bearer here, which broke the terminal desktop WS
        // when the ticket endpoint was unreachable — the client legitimately
        // fell back to its Basic creds and got a silent 401.
        let legacyAllowed = true
        try {
          const cfg = await Config.get()
          const v = (cfg as any)?.experimental?.ws_auth_legacy
          if (v === false) legacyAllowed = false
        } catch {}
        if (legacyAllowed) {
          const q = c.req.query("authorization")
          if (q?.startsWith("Bearer ") || q?.startsWith("Basic ")) authHeader = q
        }
      }

      // Try JWT Bearer token first
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7)
        const payload = verifyAccessToken(token)
        if (payload) {
          bindPrincipal(c, {
            id: payload.sub,
            username: payload.username,
            role: payload.role,
            via: "bearer",
          })
          return next()
        }
        // Invalid JWT — don't fall through, reject
        throw new HTTPException(401, { message: "Invalid or expired token" })
      }

      // Fall back to Basic Auth (backward compatibility) — header only.
      if (authHeader?.startsWith("Basic ")) {
        const { Flag } = await import("../flag/flag")
        const password = Flag.UNIFIA_SERVER_PASSWORD
        if (!password) return next() // No password configured — allow
        const username = Flag.UNIFIA_SERVER_USERNAME ?? "unifia"

        if (basicCredentialsMatch(authHeader.slice(6), username, password)) {
          bindPrincipal(c, {
            id: "basic-auth",
            username,
            role: "admin" as UserRole,
            via: "basic",
          })
          return next()
        }
        throw new HTTPException(401, { message: "Invalid credentials" })
      }

      // No auth header — check if auth is required
      const { Flag } = await import("../flag/flag")
      const password = Flag.UNIFIA_SERVER_PASSWORD
      if (!password) {
        // Check collaborative config
        let requireAuth = false
        try {
          const cfg = await Config.get()
          requireAuth = cfg?.experimental?.collaborative?.require_auth ?? false
        } catch {}
        if (!requireAuth) return next()
      }

      throw new HTTPException(401, { message: "Authentication required" })
    }
  }
}
