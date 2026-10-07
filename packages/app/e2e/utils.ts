import { createUnifiaClient } from "@unifia/sdk/v2/client"
import { base64Encode, checksum } from "@unifia/util/encode"

export const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
export const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"

export const serverUrl = `http://${serverHost}:${serverPort}`
export const serverName = `${serverHost}:${serverPort}`

const localHosts = ["127.0.0.1", "localhost"]

const serverLabels = (() => {
  const url = new URL(serverUrl)
  if (!localHosts.includes(url.hostname)) return [serverName]
  return localHosts.map((host) => `${host}:${url.port}`)
})()

export const serverNames = [...new Set(serverLabels)]

export const serverUrls = serverNames.map((name) => `http://${name}`)

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const serverNamePattern = new RegExp(`(?:${serverNames.map(escape).join("|")})`)

export const modKey = process.platform === "darwin" ? "Meta" : "Control"
export const terminalToggleKey = "Control+Backquote"

/**
 * The URL of the `backend` fixture this worker actually started.
 *
 * WHY: the worker-scoped backend fixture binds the real server to a RANDOM free
 * port, but every SDK helper here defaulted to the fixed PLAYWRIGHT_SERVER_PORT
 * (4096). Nothing listens there unless a server was started by hand, so any
 * spec that omitted an explicit `serverUrl` died on ECONNREFUSED 127.0.0.1:4096
 * before it ever reached the UI. Measured on dev@ca7ea5548, that refusal alone
 * accounted for 4 of the 5 `projects/` failures.
 *
 * Module state rather than `process.env` on purpose: Playwright gives each
 * worker its own process, so each records its own backend and they cannot
 * overwrite one another. The `backend` fixture is the only writer.
 *
 * `serverUrl` itself is left alone — it is the documented default for callers
 * that legitimately want the fixed port, and it backs `serverNamePattern`.
 */
let activeServerUrl: string | undefined

export function setActiveServerUrl(url: string) {
  activeServerUrl = url
}

export function defaultServerUrl() {
  return activeServerUrl ?? serverUrl
}

export function createSdk(directory?: string, baseUrl = defaultServerUrl()) {
  return createUnifiaClient({ baseUrl, directory, throwOnError: true })
}

export async function resolveDirectory(directory: string, baseUrl = defaultServerUrl()) {
  return createSdk(directory, baseUrl)
    .path.get()
    .then((x) => x.data?.directory ?? directory)
}

export async function getWorktree(baseUrl = defaultServerUrl()) {
  const sdk = createSdk(undefined, baseUrl)
  const result = await sdk.path.get()
  const data = result.data
  if (!data?.worktree) throw new Error(`Failed to resolve a worktree from ${baseUrl}/path`)
  return data.worktree
}

export function dirSlug(directory: string) {
  return base64Encode(directory)
}

export function dirPath(directory: string) {
  return `/${dirSlug(directory)}`
}

export function sessionPath(directory: string, sessionID?: string) {
  return `${dirPath(directory)}/session${sessionID ? `/${sessionID}` : ""}`
}

export function workspacePersistKey(directory: string, key: string) {
  const head = (directory.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(directory) ?? "0"
  return `unifia.workspace.${head}.${sum}.dat:workspace:${key}`
}
