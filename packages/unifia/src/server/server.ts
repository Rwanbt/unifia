import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono, type Context } from "hono"
import { compress } from "hono/compress"
import { cors } from "hono/cors"
import { JwtAuth, principalOf } from "./auth-jwt"
import { Flag } from "../flag/flag"
import { isLoopbackAddress, isLoopbackHostHeader } from "./loopback-host"
import { allowedBrowserOrigins, refuseBrowserRequest } from "./browser-origin"
import { AuthRoutes } from "./routes/auth"
import z from "zod"
import { Auth } from "../auth"
import { ProviderID } from "../provider/schema"
import { WorkspaceRouterMiddleware } from "./router"
import { websocket } from "hono/bun"
import { errors } from "./error"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { lazy } from "@/util/lazy"
import { errorHandler } from "./middleware"
import { InstanceRoutes } from "./instance"
import { initProjectors } from "./projectors"
import { initShadowDaemon } from "../collective/shadow-integration"
import { createWorkbenchBridge } from "./workbench"
import { VoiceLiveRoutes } from "./routes/voice-live"
import { VoiceTtsRoutes } from "./routes/voice-tts"

globalThis.AI_SDK_LOG_WARNINGS = false

initProjectors()
initShadowDaemon()

export namespace Server {
  const log = Log.create({ service: "server" })

  const zipped = compress()

  const skipCompress = (path: string, method: string) => {
    if (path === "/event" || path === "/global/event" || path === "/global/sync-event") return true
    if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(path)) return true
    return false
  }

  /**
   * Whether the client of this request is beyond loopback. The address is the client's, as the server's socket reports it: the
   * server's own bind address says nothing about who asks. A server bound to all interfaces answers the desktop on loopback too.
   */
  function clientIsRemote(c: Context): boolean {
    const env = c.env as
      | { hostname?: string; requestIP?: (request: Request) => { address: string } | null }
      | undefined
    const address = env?.requestIP?.(c.req.raw)?.address
    if (address !== undefined) return !isLoopbackAddress(address)
    return env?.hostname !== undefined && !isLoopbackAddress(env.hostname)
  }

  /**
   * The native token route, when the client is beyond loopback. The token alone is the desktop's authority on its own host. A
   * client beyond loopback must also present the owner's own authority, the credential the other routes accept, and hold the
   * admin role: a token that reached a remote machine is not enough by itself.
   */
  function nativeRouteNeedsOwner(c: Context): boolean {
    return c.req.path === "/workbench/native/token" && clientIsRemote(c)
  }

  export const Default = lazy(() => ControlPlaneRoutes())

  export const ControlPlaneRoutes = (opts?: { cors?: string[] }): Hono => {
    const app = new Hono()
    // Built once, outside the try below: an invalid configured origin must stop the server at startup,
    // not quietly leave the Workbench bridge without its origin list.
    const allowed = allowedBrowserOrigins(opts?.cors)
    // The Workbench bridge is an optional surface: the two routes below
    // already answer 404 when it is absent. A failure to build it must
    // degrade that surface only — an exception here aborts listen() and
    // kills the sidecar, leaving the desktop app with no server at all.
    const workbench = (() => {
      try {
        return createWorkbenchBridge(allowed)
      } catch (e) {
        log.error("workbench bridge unavailable", { error: e instanceof Error ? e.message : String(e) })
        return undefined
      }
    })()
    return app
      .onError(errorHandler(log))
      // A server bound to loopback, without credentials, answers only requests addressed to loopback.
      // Without this, a web page can reach it under a host name it controls (DNS rebinding) and read
      // every route. With credentials, a page cannot send them under such a name, so the check is not needed.
      .use(async (c, next) => {
        if (Flag.UNIFIA_SERVER_PASSWORD) return next()
        const bound = (c.env as { hostname?: string } | undefined)?.hostname
        const boundToLoopback = bound === undefined || isLoopbackAddress(bound)
        // A request with no Host header cannot be a rebinding page: browsers always send one. Those
        // requests come from in-process callers and HTTP/1.0 clients, and are not refused here.
        const host = c.req.header("host")
        if (!boundToLoopback || host === undefined || isLoopbackHostHeader(host)) return next()
        return c.json({ error: "untrusted request target" }, 403)
      })
      // A browser request from an origin the server does not trust is refused before any route sees it,
      // the Workbench routes included: they skip JwtAuth, and the browser would attach cached credentials.
      .use(async (c, next) => {
        const refusal = refuseBrowserRequest({
          origin: c.req.header("origin") ?? null,
          secFetchSite: c.req.header("sec-fetch-site") ?? null,
          sameOrigin: new URL(c.req.url).origin,
          allowed,
        })
        if (refusal) return c.json({ error: "cross-origin browser request refused", reason: refusal }, 403)
        return next()
      })
      .use(async (c, next) => {
        if (workbench && c.req.path.startsWith("/workbench/") && !nativeRouteNeedsOwner(c)) return next()
        return JwtAuth.middleware()(c, next)
      })
      .use(async (c, next) => {
        const skip = c.req.path === "/log"
        if (!skip) {
          log.info("request", {
            method: c.req.method,
            path: c.req.path,
          })
        }
        const timer = log.time("request", {
          method: c.req.method,
          path: c.req.path,
        })
        await next()
        if (!skip) {
          timer.stop()
        }
      })
      // WHY the Workbench routes sit exactly here: registered before the
      // logger above they never produced a log line, so an empty journal read
      // as "the client never called" when the call had in fact been answered.
      // They stay before cors() because the WorkbenchServer emits its own CORS
      // headers — the contract asserted by workbench-server's cors-contract
      // and real-transport suites — and a second layer must not rewrite them.
      .all("/workbench/native/token", async (c) => {
        if (!workbench) return c.json({ error: "Workbench native bridge unavailable" }, 404)
        if (nativeRouteNeedsOwner(c) && principalOf(c.req.raw)?.role !== "admin") {
          log.warn("native Workbench route refused: owner authority required from a remote client")
          return c.json({ error: "owner authority required" }, 403)
        }
        return workbench.native(c.req.raw)
      })
      .all("/workbench/*", async (c) => workbench ? workbench.fetch(c.req.raw) : c.json({ error: "Workbench unavailable" }, 404))
      .use(
        cors({
          maxAge: 86_400,
          // WHY an exact list: the earlier rule reflected any localhost or 127.0.0.1 port, so any local
          // web page could read every response. Same-origin pages need no CORS header at all.
          origin(input) {
            if (!input) return
            return allowed.includes(input) ? input : undefined
          },
        }),
      )
      .use((c, next) => {
        if (skipCompress(c.req.path, c.req.method)) return next()
        return zipped(c, next)
      })
      // ADR-041: web runtime's lease route. Outside /workbench/*, so the auth
      // middleware above applies, and after cors() like every browser-facing
      // route. The bridge only exists with UNIFIA_SERVER_PASSWORD set.
      .post("/workbench-web/token", async (c) => {
        if (!workbench) return c.json({ error: "Workbench web bridge unavailable" }, 404)
        // A lease carries write capabilities; a read-only collaborative
        // account must not obtain one (ADR-041, /cso finding 1). Basic auth
        // is recorded as an admin by the middleware.
        const caller = c.get("user" as never) as { role: string } | undefined
        if (!caller || caller.role === "viewer") {
          return c.json({ error: "Workbench leases require an admin or member account" }, 403)
        }
        return workbench.web(c.req.raw)
      })
      .route("/collab", AuthRoutes())
      .route("/global", GlobalRoutes())
      .route("/voice/live", VoiceLiveRoutes())
      .route("/voice/tts", VoiceTtsRoutes())
      .put(
        "/auth/:providerID",
        describeRoute({
          summary: "Set auth credentials",
          description: "Set authentication credentials",
          operationId: "auth.set",
          responses: {
            200: {
              description: "Successfully set authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        validator("json", Auth.Info.zod),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          const info = c.req.valid("json")
          await Auth.set(providerID, info)
          return c.json(true)
        },
      )
      .delete(
        "/auth/:providerID",
        describeRoute({
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
          operationId: "auth.remove",
          responses: {
            200: {
              description: "Successfully removed authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          await Auth.remove(providerID)
          return c.json(true)
        },
      )
      .get(
        "/doc",
        openAPIRouteHandler(app, {
          documentation: {
            info: {
              title: "unifia",
              version: "0.0.3",
              description: "unifia api",
            },
            openapi: "3.1.1",
          },
        }),
      )
      .use(
        validator(
          "query",
          z.object({
            directory: z.string().optional(),
            workspace: z.string().optional(),
          }),
        ),
      )
      .post(
        "/log",
        describeRoute({
          summary: "Write log",
          description: "Write a log entry to the server logs with specified level and metadata.",
          operationId: "app.log",
          responses: {
            200: {
              description: "Log entry written successfully",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "json",
          z.object({
            service: z.string().meta({ description: "Service name for the log entry" }),
            level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
            message: z.string().meta({ description: "Log message" }),
            extra: z
              .record(z.string(), z.any())
              .optional()
              .meta({ description: "Additional metadata for the log entry" }),
          }),
        ),
        async (c) => {
          const { service, level, message, extra } = c.req.valid("json")
          const logger = Log.create({ service })

          switch (level) {
            case "debug":
              logger.debug(message, extra)
              break
            case "info":
              logger.info(message, extra)
              break
            case "error":
              logger.error(message, extra)
              break
            case "warn":
              logger.warn(message, extra)
              break
          }

          return c.json(true)
        },
      )
      .use(WorkspaceRouterMiddleware)
  }

  export function createApp(opts: { cors?: string[] }) {
    return ControlPlaneRoutes(opts)
  }

  export async function openapi() {
    // Build a fresh app with all routes registered directly so
    // hono-openapi can see describeRoute metadata (`.route()` wraps
    // handlers when the sub-app has a custom errorHandler, which
    // strips the metadata symbol).
    const app = ControlPlaneRoutes()
    InstanceRoutes(app)
    const result = await generateSpecs(app, {
      documentation: {
        info: {
          title: "unifia",
          version: "1.0.0",
          description: "unifia api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  /** @deprecated do not use this dumb shit */
  export let url: URL

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }) {
    // WHY: a listener reachable from the network answers any peer that can reach it. Without credentials
    // nothing stops that peer, so the server refuses to start rather than run unsecured. The desktop and
    // mobile sidecars always pass a password, so this only stops an unsecured network listener.
    if (!isLoopbackAddress(opts.hostname) && !Flag.UNIFIA_SERVER_PASSWORD) {
      throw new Error(`refusing to listen on ${opts.hostname} without UNIFIA_SERVER_PASSWORD: a network-reachable server needs credentials`)
    }
    // TLS (Internet mode): cert and key paths are passed via env vars by the Tauri sidecar.
    const tlsCertPath = process.env.UNIFIA_TLS_CERT_PATH
    const tlsKeyPath = process.env.UNIFIA_TLS_KEY_PATH
    const tls =
      tlsCertPath && tlsKeyPath
        ? { cert: Bun.file(tlsCertPath), key: Bun.file(tlsKeyPath) }
        : undefined

    const scheme = tls ? "https" : "http"
    url = new URL(`${scheme}://${opts.hostname}:${opts.port}`)

    const app = ControlPlaneRoutes({ cors: opts.cors })
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
      websocket: websocket,
      ...(tls ? { tls } : {}),
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
