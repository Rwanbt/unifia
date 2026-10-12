import { Hono } from "hono"
import { Broadcast } from "../broadcast"
import { Presence } from "../presence"
import { principalOf } from "../auth-jwt"
import { FileLock } from "../../file/lock"
import { Log } from "../../util/log"

const log = Log.create({ service: "ws-event" })

export const WsEventRoutes = () =>
  new Hono().get("/events", async (c) => {
    // The identity is the one the auth middleware verified for this request: a token in the query string is not read, because
    // a URL is written to proxy and access logs. A request the middleware admitted without a credential is anonymous.
    const principal = principalOf(c.req.raw)
    const userID = principal?.id ?? "anonymous"
    const username = principal?.username ?? "anonymous"
    const role = principal?.role ?? "viewer"

    const directory = c.req.query("directory")

    // Use Bun's native WebSocket upgrade
    const server = (c.env as any)?.server
    if (!server) {
      return c.json({ error: "WebSocket not supported" }, 400)
    }

    const success = server.upgrade(c.req.raw, {
      data: { userID, username, role, directory },
    })

    if (!success) {
      return c.json({ error: "WebSocket upgrade failed" }, 400)
    }

    return new Response(null, { status: 101 })
  })

/**
 * WebSocket handlers for Bun.serve() websocket option.
 * These are registered at the server level, not per-route.
 */
export const WsEventHandlers = {
  open(ws: any) {
    const { userID, username, directory } = ws.data || {}
    if (!userID) return

    const clientID = Broadcast.register(ws, userID, username, directory)
    ws.data.clientID = clientID

    Presence.connect(userID, username, directory)
    log.info("ws client connected", { userID, username, directory })
  },

  message(ws: any, message: string | Buffer) {
    // Handle ping/pong keepalive
    const { userID } = ws.data || {}
    if (!userID) return

    try {
      const data = JSON.parse(typeof message === "string" ? message : message.toString())
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }))
        Presence.heartbeat(userID)
      } else if (data.type === "activity") {
        // Client reports what session they're working on
        Presence.updateActivity(userID, data.sessionID)
      }
    } catch {
      // Ignore malformed messages
    }
  },

  close(ws: any) {
    const { clientID, userID } = ws.data || {}
    if (clientID) {
      Broadcast.unregister(clientID)
    }
    if (userID) {
      Presence.disconnect(userID)
      FileLock.releaseAllForUser(userID)
      log.info("ws client disconnected", { userID })
    }
  },
}
