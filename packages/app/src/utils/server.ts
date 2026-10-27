import { createUnifiaClient } from "../types/sdk-shim"
import type { ServerConnection } from "@/context/server"

/** Basic credentials of a server connection, as the SDK sends them. */
export function serverBasicAuthorization(server: ServerConnection.HttpBase): string | undefined {
  if (!server.password) return undefined
  return `Basic ${btoa(`${server.username ?? "unifia"}:${server.password}`)}`
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createUnifiaClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const basic = serverBasicAuthorization(server)
  const auth = basic ? { Authorization: basic } : undefined

  return createUnifiaClient({
    ...config,
    // An explicit Bearer session must take precedence over legacy Basic
    // connection credentials. Basic remains the fallback for unmodified flows.
    headers: { ...auth, ...config.headers },
    baseUrl: server.url,
  })
}

/**
 * Headers for a raw request to a server connection, authorized exactly as an SDK request:
 * a Bearer session wins over Basic connection credentials, and a caller's own header wins over both.
 */
export function serverRequestHeaders(
  server: ServerConnection.HttpBase,
  bearer: string | undefined,
  init?: HeadersInit,
): Headers {
  const headers = new Headers(init)
  const authorization = bearer ?? serverBasicAuthorization(server)
  if (authorization && !headers.has("authorization")) headers.set("Authorization", authorization)
  return headers
}
