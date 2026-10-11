/* SPDX-License-Identifier: MIT */
/**
 * The credentials the desktop host gives its sidecar, on the sidecar's stdin.
 *
 * WHY stdin and not the environment: every process the sidecar starts inherits its environment, and the agent's shell
 * commands are such processes. The environment of a process is also readable by processes of the same user. A basic
 * credential is the owner's authority on the server's routes, so it must reach the sidecar without being in either place.
 *
 * The host writes one line of JSON on the stdin pipe it already holds for the parent watchdog, then keeps the pipe open.
 * The sidecar reads that line once, before the watchdog starts, and keeps the values in memory. The end of stdin still
 * means the host is gone, so a host that dies before sending credentials leaves nothing running.
 *
 * What this does not do: a process of the same user can still read the sidecar's memory where the operating system
 * allows it (ptrace or equivalent). See docs/adr/ADR-094-sidecar-credential-channel.md for the boundary.
 */
import { Log } from "../util/log"
import { holdCredentials, type HeldCredentials } from "../flag/held-credentials"

const log = Log.create({ service: "sidecar-credentials" })

/** A credential line is a few hundred bytes. Anything larger is not what the host sends. */
const LINE_MAX_BYTES = 64 * 1024
const READ_TIMEOUT_MS = 10_000

export type SidecarCredentials = HeldCredentials

const FIELDS = ["username", "password", "keychainToken"] as const

/** Only the three known fields, each a string. Anything else in the line is refused, not ignored. */
export function parseCredentialLine(line: string): SidecarCredentials {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error("the credential line is not JSON")
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the credential line is not an object")
  }
  const out: SidecarCredentials = {}
  for (const [key, field] of Object.entries(value)) {
    if (!(FIELDS as readonly string[]).includes(key)) throw new Error(`unknown credential field: ${key}`)
    if (typeof field !== "string") throw new Error(`credential field is not a string: ${key}`)
    out[key as keyof SidecarCredentials] = field
  }
  return out
}

/**
 * Read the first line of stdin as the credentials, and hold them. Fails closed: end of stdin, a line that is too long,
 * a line that is not the expected JSON, or no line within the timeout all reject. The caller exits on rejection.
 *
 * It must run before anything arms the parent watchdog. The watchdog resumes stdin without a data listener, and
 * Node discards what arrives while no listener is attached.
 */
export function readCredentialLine(
  stdin: NodeJS.ReadableStream = process.stdin,
  timeoutMs: number = READ_TIMEOUT_MS,
): Promise<SidecarCredentials> {
  return new Promise((resolve, reject) => {
    let buffer = ""
    let settled = false

    const detach = () => {
      clearTimeout(timer)
      stdin.removeListener("data", onData)
      stdin.removeListener("end", onEnd)
      stdin.removeListener("error", onError)
      // Paused, not closed: the watchdog resumes it, and its 'end' listener is what detects the host going away.
      ;(stdin as NodeJS.ReadStream).pause?.()
    }
    const finish = (error: Error | null, credentials?: SidecarCredentials) => {
      if (settled) return
      settled = true
      detach()
      if (error) reject(error)
      else resolve(credentials!)
    }

    const onData = (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      const end = buffer.indexOf("\n")
      if (end === -1) {
        if (buffer.length > LINE_MAX_BYTES) finish(new Error("the credential line is too long"))
        return
      }
      const line = buffer.slice(0, end)
      buffer = ""
      try {
        const credentials = parseCredentialLine(line)
        holdCredentials(credentials)
        log.info("credentials received from the host")
        finish(null, credentials)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onEnd = () => finish(new Error("stdin closed before the credentials arrived"))
    const onError = (error: unknown) => finish(error instanceof Error ? error : new Error(String(error)))

    const timer = setTimeout(() => finish(new Error("no credentials arrived on stdin")), timeoutMs)
    stdin.on("data", onData)
    stdin.on("end", onEnd)
    stdin.on("error", onError)
    ;(stdin as NodeJS.ReadStream).resume?.()
  })
}
