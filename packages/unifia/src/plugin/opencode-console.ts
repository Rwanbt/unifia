/* SPDX-License-Identifier: MIT */
import type { Hooks, PluginInput } from "@unifia/plugin"
import { setTimeout as sleep } from "node:timers/promises"
import { Installation } from "@/installation"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.opencode-console" })

// Same device flow as upstream OpenCode's Console sign-in (packages/core/src/plugin/provider/opencode.ts).
export const CONSOLE_SERVER = "https://opencode.ai/console"
const CLIENT_ID = "opencode-cli"
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
// One sign-in serves both Console providers, so the credential is written to each of them.
export const CONSOLE_PROVIDERS = ["opencode", "opencode-go"] as const
// Refresh a little before expiry so a request never leaves with a token that dies in flight.
const REFRESH_MARGIN_MS = 60_000
const SLOW_DOWN_STEP_MS = 5_000

type Fetch = typeof fetch

export interface DeviceCode {
  readonly device_code: string
  readonly user_code: string
  readonly verification_uri_complete: string
  readonly interval: number
}

export interface ConsoleToken {
  readonly access: string
  readonly refresh: string
  readonly expires: number
  readonly orgID?: string
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  org_id?: string | null
  error?: string
}

function postJson(fetchImpl: Fetch, url: string, body: Record<string, string | boolean>) {
  return fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": `unifia/${Installation.VERSION}`,
    },
    body: JSON.stringify(body),
  })
}

function toToken(response: TokenResponse, now: number, fallbackOrgID?: string): ConsoleToken {
  if (!response.access_token || !response.refresh_token || typeof response.expires_in !== "number")
    throw new Error("OpenCode Console returned an incomplete token")
  return {
    access: response.access_token,
    refresh: response.refresh_token,
    expires: now + response.expires_in * 1000,
    orgID: response.org_id ?? fallbackOrgID,
  }
}

export async function requestDeviceCode(fetchImpl: Fetch = fetch): Promise<DeviceCode & { url: string }> {
  const response = await postJson(fetchImpl, `${CONSOLE_SERVER}/auth/device/code`, {
    client_id: CLIENT_ID,
    supports_org_scope: true,
  })
  if (!response.ok) throw new Error(`OpenCode Console device authorization failed: ${response.status}`)
  const device = (await response.json()) as DeviceCode
  // The Console answers with a path relative to its own base.
  const url = new URL(device.verification_uri_complete, `${CONSOLE_SERVER}/`)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid device verification URL")
  return { ...device, url: url.href }
}

export async function pollDeviceToken(
  device: Pick<DeviceCode, "device_code" | "interval">,
  options: { fetch?: Fetch; wait?: (ms: number) => Promise<unknown>; now?: () => number } = {},
): Promise<ConsoleToken> {
  const fetchImpl = options.fetch ?? fetch
  const wait = options.wait ?? sleep
  const now = options.now ?? Date.now
  let delay = Math.max(device.interval, 1) * 1000
  while (true) {
    await wait(delay)
    const response = await postJson(fetchImpl, `${CONSOLE_SERVER}/auth/device/token`, {
      grant_type: DEVICE_GRANT,
      device_code: device.device_code,
      client_id: CLIENT_ID,
    })
    const body = (await response.json()) as TokenResponse
    if (body.access_token) return toToken(body, now())
    if (body.error === "authorization_pending") continue
    if (body.error === "slow_down") {
      delay += SLOW_DOWN_STEP_MS
      continue
    }
    throw new Error(`OpenCode Console device authorization failed: ${body.error ?? response.status}`)
  }
}

export async function refreshConsoleToken(
  token: Pick<ConsoleToken, "refresh" | "orgID">,
  options: { fetch?: Fetch; now?: () => number } = {},
): Promise<ConsoleToken> {
  const response = await postJson(options.fetch ?? fetch, `${CONSOLE_SERVER}/auth/device/token`, {
    grant_type: "refresh_token",
    refresh_token: token.refresh,
    client_id: CLIENT_ID,
  })
  const body = (await response.json().catch(() => ({}))) as TokenResponse
  if (body.error === "invalid_grant") throw new Error("OpenCode Console session expired; sign in again")
  if (!response.ok) throw new Error(`OpenCode Console token refresh failed: ${response.status}`)
  return toToken(body, (options.now ?? Date.now)(), token.orgID)
}

export function needsRefresh(expires: number, now = Date.now()) {
  return expires - REFRESH_MARGIN_MS <= now
}

// The Console's provider config routes inference by organization with this header.
export function consoleHeaders(token: Pick<ConsoleToken, "access" | "orgID">): Record<string, string> {
  return {
    authorization: `Bearer ${token.access}`,
    ...(token.orgID ? { "x-opencode-org-id": token.orgID } : {}),
  }
}

function mergeHeaders(init: RequestInit | undefined, extra: Record<string, string>) {
  const headers = new Headers(init?.headers)
  for (const [key, value] of Object.entries(extra)) headers.set(key, value)
  return headers
}

export function OpencodeConsoleAuthPlugin(providerID: (typeof CONSOLE_PROVIDERS)[number]) {
  return async (input: PluginInput): Promise<Hooks> => {
    const persist = async (token: ConsoleToken) => {
      for (const id of CONSOLE_PROVIDERS) {
        await input.client.auth.set({
          path: { id },
          body: {
            type: "oauth",
            access: token.access,
            refresh: token.refresh,
            expires: token.expires,
            ...(token.orgID ? { accountId: token.orgID } : {}),
          },
        })
      }
    }

    return {
      auth: {
        provider: providerID,
        async loader(getAuth) {
          const auth = await getAuth()
          if (auth.type !== "oauth") return {}
          return {
            apiKey: "",
            async fetch(request: RequestInfo | URL, init?: RequestInit) {
              const current = await getAuth()
              if (current.type !== "oauth") return fetch(request, init)
              let token: ConsoleToken = {
                access: current.access,
                refresh: current.refresh,
                expires: current.expires,
                orgID: (current as { accountId?: string }).accountId,
              }
              if (needsRefresh(token.expires)) {
                log.info("refreshing OpenCode Console token")
                token = await refreshConsoleToken(token)
                await persist(token)
              }
              return fetch(request, { ...init, headers: mergeHeaders(init, consoleHeaders(token)) })
            },
          }
        },
        methods: [
          {
            label: "OpenCode Console account",
            type: "oauth",
            async authorize() {
              const device = await requestDeviceCode()
              return {
                url: device.url,
                instructions: `Enter code: ${device.user_code}`,
                method: "auto" as const,
                async callback() {
                  const token = await pollDeviceToken(device).catch((error) => {
                    log.error("OpenCode Console sign-in failed", { error })
                    return undefined
                  })
                  if (!token) return { type: "failed" as const }
                  // The caller stores this provider; the sibling provider is written here.
                  await persist(token)
                  return {
                    type: "success" as const,
                    access: token.access,
                    refresh: token.refresh,
                    expires: token.expires,
                    ...(token.orgID ? { accountId: token.orgID } : {}),
                  }
                },
              }
            },
          },
          { label: "API key", type: "api" },
        ],
      },
      // OpenCode Go rejects requests without a session id ("MissingSessionID"), whatever the credential.
      "chat.headers": async (hookInput, output) => {
        if (hookInput.model.providerID !== providerID) return
        output.headers["x-opencode-session"] = hookInput.sessionID
      },
    }
  }
}
