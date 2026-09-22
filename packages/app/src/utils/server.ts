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
