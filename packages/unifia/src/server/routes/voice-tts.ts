/* SPDX-License-Identifier: MIT */

import { Hono, type Context } from "hono"
import z from "zod"

const MAX_REQUEST_BYTES = 32 * 1024
const MAX_TEXT_BYTES = 24 * 1024
const MAX_REQUESTS_PER_MINUTE = 30
const requestSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_BYTES),
  language: z.enum(["en", "fr", "es", "it", "de"]),
  voice: z.string().max(128).optional(),
  requestId: z.string().regex(/^tts_[A-Za-z0-9_-]{1,60}$/),
}).strict()

export interface VoiceTtsOptions {
  nativeUrl?: string
  nativeToken?: string
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  now?: () => number
}

async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error("missing body")
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel()
      throw new Error("request too large")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

function allowed(c: Context): boolean {
  const caller = c.get("user" as never) as { role?: string } | undefined
  return !caller || caller.role !== "viewer"
}

function privateEndpoint(raw: string | undefined): string | undefined {
  if (!raw) return
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password) return
    return url.origin
  } catch {
    return
  }
}

export function VoiceTtsRoutes(options: VoiceTtsOptions = {}) {
  const nativeUrl = privateEndpoint(options.nativeUrl ?? process.env.UNIFIA_KEYCHAIN_URL)
  const nativeToken = options.nativeToken ?? process.env.UNIFIA_KEYCHAIN_TOKEN
  const fetchNative = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const issued: number[] = []

  const rateLimited = () => {
    const cutoff = now() - 60_000
    while (issued.length && issued[0] <= cutoff) issued.shift()
    if (issued.length >= MAX_REQUESTS_PER_MINUTE) return true
    issued.push(now())
    return false
  }

  return new Hono()
    .post("/", async (c) => {
      if (!allowed(c)) return c.json({ error: "voice_tts_forbidden" }, 403)
      if (!nativeUrl || !nativeToken) return c.json({ error: "voice_tts_unavailable" }, 503)
      if (rateLimited()) return c.json({ error: "rate_limited" }, 429)
      let input: z.infer<typeof requestSchema>
      try {
        const parsed = requestSchema.safeParse(await readJson(c.req.raw))
        if (!parsed.success) return c.json({ error: "invalid_request" }, 400)
        input = parsed.data
      } catch {
        return c.json({ error: "invalid_request" }, 400)
      }
      try {
        const response = await fetchNative(`${nativeUrl}/tts/synthesize`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-keychain-token": nativeToken },
          body: JSON.stringify(input),
          signal: c.req.raw.signal,
        })
        if (!response.ok) return c.json({ error: "voice_tts_failed" }, response.status as 400)
        return new Response(response.body, {
          status: 200,
          headers: { "content-type": "audio/wav", "cache-control": "no-store" },
        })
      } catch {
        return c.json({ error: "voice_tts_unavailable" }, 503)
      }
    })
    .post("/cancel", async (c) => {
      if (!allowed(c)) return c.json({ error: "voice_tts_forbidden" }, 403)
      if (!nativeUrl || !nativeToken) return c.json({ error: "voice_tts_unavailable" }, 503)
      const parsed = requestSchema.pick({ requestId: true }).safeParse(await c.req.json().catch(() => undefined))
      if (!parsed.success) return c.json({ error: "invalid_request" }, 400)
      try {
        const response = await fetchNative(`${nativeUrl}/tts/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-keychain-token": nativeToken },
          body: JSON.stringify(parsed.data),
          signal: c.req.raw.signal,
        })
        return response.status === 204 ? c.body(null, 204) : c.json({ error: "voice_tts_cancel_failed" }, response.status as 400)
      } catch {
        return c.json({ error: "voice_tts_unavailable" }, 503)
      }
    })
}
