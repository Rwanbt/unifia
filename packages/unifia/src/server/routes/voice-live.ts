/* SPDX-License-Identifier: MIT */

// Live voice: the trusted Unifia server issues short-lived LiveKit room tokens
// and keeps the opaque binding between a Live room and a Unifia session.
//
// Why here: this server is already the authenticated boundary every client
// (desktop WebView, paired phone) talks to, so Live reuses its pairing and
// auth instead of inventing another one. The LiveKit API secret never leaves
// this process: clients get a JWT limited to one room and one microphone.
import { createHmac, randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Hono, type Context } from "hono"
import z from "zod"
import { Log } from "../../util/log"

const log = Log.create({ service: "voice-live" })

export const LIVE_AGENT_NAME = "unifia-voice"
const TOKEN_TTL_SECONDS = 10 * 60
const BINDING_TTL_MS = 12 * 60 * 60 * 1000
const MAX_BINDINGS = 64
const MAX_TOKENS_PER_MINUTE = 20
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

export interface VoiceHostState {
  url: string
  lanUrl?: string
  apiKey: string
  apiSecret: string
}

export interface LiveBinding {
  id: string
  room: string
  identity: string
  directory: string
  sessionID?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  language: string
  locale?: string
  voices: Record<string, string>
  speed: number
  createdAt: number
}

function opaque(length: number): string {
  const bytes = randomBytes(length)
  let out = ""
  for (const byte of bytes) out += BASE62[byte % 62]
  return out
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url")
}

/** HS256 LiveKit access token (the format LiveKit servers verify). */
export function mintLiveKitToken(input: {
  apiKey: string
  apiSecret: string
  identity: string
  room: string
  metadata: string
  now?: number
  ttlSeconds?: number
}): { token: string; expiresAt: number } {
  const now = Math.floor((input.now ?? Date.now()) / 1000)
  const expiresAt = now + (input.ttlSeconds ?? TOKEN_TTL_SECONDS)
  const claims = {
    iss: input.apiKey,
    sub: input.identity,
    nbf: now - 5,
    exp: expiresAt,
    jti: opaque(16),
    video: {
      room: input.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: ["microphone"],
      canUpdateOwnMetadata: false,
    },
    roomConfig: {
      name: input.room,
      emptyTimeout: 120,
      departureTimeout: 120,
      maxParticipants: 2,
      agents: [{ agentName: LIVE_AGENT_NAME, metadata: input.metadata }],
    },
  }
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = base64url(JSON.stringify(claims))
  const signature = createHmac("sha256", input.apiSecret).update(`${header}.${body}`).digest("base64url")
  return { token: `${header}.${body}.${signature}`, expiresAt: expiresAt * 1000 }
}

const hostFile = z.object({
  url: z.string().regex(/^wss?:\/\//),
  lanUrl: z.string().regex(/^wss?:\/\//).optional(),
  apiKey: z.string().min(8),
  apiSecret: z.string().min(32),
  state: z.literal("ready"),
})

/** Reads the state the desktop Voice Host supervisor publishes, or undefined. */
export async function readVoiceHostState(dir = process.env.UNIFIA_VOICE_HOST_DIR): Promise<VoiceHostState | undefined> {
  if (!dir) return undefined
  try {
    const parsed = hostFile.safeParse(JSON.parse(await readFile(path.join(dir, "livekit.json"), "utf8")))
    if (!parsed.success) return undefined
    const { url, lanUrl, apiKey, apiSecret } = parsed.data
    return { url, lanUrl, apiKey, apiSecret }
  } catch {
    return undefined
  }
}

const sessionRequest = z
  .object({
    binding: z.string().regex(/^lvb_[A-Za-z0-9]{32}$/).optional(),
    directory: z.string().min(1).max(4096).optional(),
    sessionID: z.string().startsWith("ses_").max(128).optional(),
    agent: z.string().max(200).optional(),
    model: z.object({ providerID: z.string().min(1).max(200), modelID: z.string().min(1).max(200) }).optional(),
    variant: z.string().max(200).optional(),
    language: z.enum(["auto", "en", "fr", "es", "it", "de"]).optional(),
    locale: z.string().max(35).optional(),
    voices: z.record(z.enum(["en", "fr", "es", "it", "de"]), z.string().max(128)).optional(),
    speed: z.number().min(0.5).max(2).optional(),
  })
  .strict()

function isLoopback(host: string | undefined): boolean {
  const hostname = (host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "")
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "tauri.localhost"
}

export interface VoiceLiveOptions {
  readHost?: () => Promise<VoiceHostState | undefined>
  now?: () => number
}

export function VoiceLiveRoutes(options: VoiceLiveOptions = {}) {
  const readHost = options.readHost ?? (() => readVoiceHostState())
  const now = options.now ?? Date.now
  const bindings = new Map<string, LiveBinding>()
  const issued: number[] = []

  const prune = () => {
    const cutoff = now() - BINDING_TTL_MS
    for (const [id, binding] of bindings) if (binding.createdAt < cutoff) bindings.delete(id)
    while (bindings.size > MAX_BINDINGS) bindings.delete(bindings.keys().next().value as string)
  }

  const allowed = (c: Context) => {
    // Basic auth is recorded as an admin by the auth middleware; a read-only
    // collaborative account must not open a microphone into the session.
    const caller = c.get("user" as never) as { role: string } | undefined
    return !caller || caller.role !== "viewer"
  }

  const hostUrl = (c: Context, host: VoiceHostState) => {
    if (isLoopback(c.req.header("host"))) return host.url
    return host.lanUrl
  }

  return new Hono()
    .get("/status", async (c) => {
      const host = await readHost()
      if (!host) return c.json({ available: false, reason: "voice_host_unavailable" })
      if (!hostUrl(c, host)) return c.json({ available: false, reason: "voice_host_lan_disabled" })
      return c.json({ available: true })
    })
    .post("/session", async (c) => {
      if (!allowed(c)) return c.json({ error: "Live voice requires an admin or member account" }, 403)
      const parsed = sessionRequest.safeParse(await c.req.json().catch(() => undefined))
      if (!parsed.success) return c.json({ error: "invalid_request" }, 400)
      const host = await readHost()
      if (!host) return c.json({ error: "voice_host_unavailable" }, 503)
      const url = hostUrl(c, host)
      if (!url) return c.json({ error: "voice_host_lan_disabled" }, 503)

      const minuteAgo = now() - 60_000
      while (issued.length && issued[0] < minuteAgo) issued.shift()
      if (issued.length >= MAX_TOKENS_PER_MINUTE) return c.json({ error: "rate_limited" }, 429)

      prune()
      const input = parsed.data
      let binding = input.binding ? bindings.get(input.binding) : undefined
      if (input.binding && !binding) return c.json({ error: "binding_expired" }, 410)
      if (!binding) {
        const directory = input.directory ?? c.req.query("directory")
        if (!directory || !path.isAbsolute(directory)) return c.json({ error: "invalid_request" }, 400)
        binding = {
          id: `lvb_${opaque(32)}`,
          room: `unifia-live-${opaque(24)}`,
          identity: `device-${opaque(16)}`,
          directory,
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          variant: input.variant,
          language: input.language ?? "auto",
          locale: input.locale,
          voices: input.voices ?? {},
          speed: input.speed ?? 1,
          createdAt: now(),
        }
        bindings.set(binding.id, binding)
      } else {
        // A reconnect keeps the room, the device identity and the session; it
        // may only carry forward the user's current model/agent selection.
        if (input.agent) binding.agent = input.agent
        if (input.model) binding.model = input.model
        if (input.variant) binding.variant = input.variant
      }
      issued.push(now())
      const { token, expiresAt } = mintLiveKitToken({
        apiKey: host.apiKey,
        apiSecret: host.apiSecret,
        identity: binding.identity,
        room: binding.room,
        metadata: JSON.stringify({ binding: binding.id }),
        now: now(),
      })
      log.info("live token issued", { binding: binding.id, lan: url !== host.url })
      return c.json({
        url,
        token,
        expiresAt,
        room: binding.room,
        binding: binding.id,
        sessionID: binding.sessionID ?? null,
      })
    })
    .get("/bindings/:id", (c) => {
      if (!allowed(c)) return c.json({ error: "forbidden" }, 403)
      prune()
      const binding = bindings.get(c.req.param("id"))
      if (!binding) return c.json({ error: "not_found" }, 404)
      return c.json(binding)
    })
    .post("/bindings/:id/session", async (c) => {
      if (!allowed(c)) return c.json({ error: "forbidden" }, 403)
      const binding = bindings.get(c.req.param("id"))
      if (!binding) return c.json({ error: "not_found" }, 404)
      const parsed = z
        .object({ sessionID: z.string().startsWith("ses_").max(128) })
        .strict()
        .safeParse(await c.req.json().catch(() => undefined))
      if (!parsed.success) return c.json({ error: "invalid_request" }, 400)
      if (binding.sessionID && binding.sessionID !== parsed.data.sessionID) {
        return c.json({ error: "binding_already_bound" }, 409)
      }
      binding.sessionID = parsed.data.sessionID
      return c.json(true)
    })
    .delete("/bindings/:id", (c) => {
      if (!allowed(c)) return c.json({ error: "forbidden" }, 403)
      return c.json(bindings.delete(c.req.param("id")))
    })
}
