/* SPDX-License-Identifier: MIT */
import { createServer, createConnection, type Socket } from "node:net"
import { Transform } from "node:stream"
import type { BrowserEgressPolicy } from "@unifia/contracts"
import { NetworkAuthority, NetworkPolicyError } from "./authority.ts"

const MAX_HEADER_BYTES = 32 * 1024
const SOCKET_TIMEOUT_MS = 15_000
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024
const FORWARDED_HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])

type PinnedConnector = (address: string, port: number) => Socket
type BrowserEgressProxyOptions = {
  policy: BrowserEgressPolicy | (() => BrowserEgressPolicy)
  authority?: NetworkAuthority
  connect?: PinnedConnector
  onDenied?: (code: NetworkPolicyError["code"]) => void
}

/** A loopback HTTP proxy that resolves, validates, and dials the same public IP. */
export class BrowserEgressProxy {
  readonly #policy: () => BrowserEgressPolicy
  readonly #authority: NetworkAuthority
  readonly #connect: PinnedConnector
  readonly #onDenied: BrowserEgressProxyOptions["onDenied"]
  #server: ReturnType<typeof createServer> | undefined
  readonly #clients = new Set<Socket>()

  constructor(options: BrowserEgressProxyOptions) {
    const policy = options.policy
    this.#policy = typeof policy === "function" ? policy : () => policy
    this.#authority = options.authority ?? new NetworkAuthority()
    this.#connect = options.connect ?? ((address, port) => createConnection({ host: address, port }))
    this.#onDenied = options.onDenied
  }

  async start(): Promise<string> {
    if (this.#server) throw new Error("browser egress proxy is already running")
    const server = createServer((client) => {
      this.#clients.add(client)
      client.once("close", () => this.#clients.delete(client))
      this.#accept(client)
    })
    this.#server = server
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("browser egress proxy failed to bind a TCP port")
    return `http://127.0.0.1:${address.port}`
  }

  async close(): Promise<void> {
    const server = this.#server
    if (!server) return
    this.#server = undefined
    this.revokeConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  revokeConnections(): void {
    for (const client of this.#clients) client.destroy()
    this.#clients.clear()
  }

  #accept(client: Socket): void {
    client.setTimeout(SOCKET_TIMEOUT_MS, () => client.destroy())
    const chunks: Buffer[] = []
    let headerBytes = 0
    const readHeader = (chunk: Buffer) => {
      chunks.push(chunk)
      const request = Buffer.concat(chunks)
      const headerEnd = request.indexOf("\r\n\r\n")
      if (headerEnd < 0) {
        headerBytes += chunk.length
        if (headerBytes > MAX_HEADER_BYTES) {
          client.off("data", readHeader)
          this.#respond(client, 431, "Request Header Fields Too Large")
        }
        return
      }
      if (headerEnd > MAX_HEADER_BYTES) {
        client.off("data", readHeader)
        this.#respond(client, 431, "Request Header Fields Too Large")
        return
      }
      client.off("data", readHeader)
      client.pause()
      void this.#handle(client, request).catch((error: unknown) => {
        if (error instanceof NetworkPolicyError) this.#onDenied?.(error.code)
        const denied = error instanceof NetworkPolicyError && error.code !== "dns-failed"
        this.#respond(client, denied ? 403 : 502, denied ? "Forbidden" : "Bad Gateway")
      })
    }
    client.on("data", readHeader)
  }

  async #handle(client: Socket, chunk: Buffer): Promise<void> {
    const end = chunk.indexOf("\r\n\r\n")
    if (end < 0 || end > MAX_HEADER_BYTES) return this.#respond(client, 431, "Request Header Fields Too Large")
    const header = chunk.subarray(0, end).toString("latin1")
    const [requestLine, ...headerLines] = header.split("\r\n")
    const match = /^(CONNECT|[A-Z]+)\s+(\S+)\s+HTTP\/1\.[01]$/.exec(requestLine ?? "")
    if (!match) return this.#respond(client, 400, "Bad Request")
    if (match[1] === "CONNECT") return this.#tunnel(client, match[2]!, chunk.subarray(end + 4))
    return this.#forwardHttp(client, match[1]!, match[2]!, headerLines, chunk.subarray(end + 4))
  }

  async #tunnel(client: Socket, authority: string, initialData: Buffer): Promise<void> {
    const destination = parseAuthority(authority, "https")
    if (destination.port !== 443) return this.#respond(client, 403, "Forbidden")
    const approved = await this.#authority.authorizeBrowserUrl(destination.url, this.#policy())
    const upstream = await this.#dial(approved.addresses[0]!, destination.port)
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    if (initialData.length) upstream.write(initialData)
    this.#pipe(client, upstream)
  }

  async #forwardHttp(client: Socket, method: string, target: string, lines: string[], body: Buffer): Promise<void> {
    let url: URL
    try { url = new URL(target) } catch { return this.#respond(client, 400, "Bad Request") }
    if (url.protocol !== "http:" || url.username || url.password || url.hash || Number(url.port || 80) !== 80 || !FORWARDED_HTTP_METHODS.has(method)) {
      return this.#respond(client, 403, "Forbidden")
    }
    const framing = requestBodyFraming(lines)
    if (!framing || framing.contentLength !== undefined && framing.contentLength > MAX_REQUEST_BODY_BYTES || body.length > MAX_REQUEST_BODY_BYTES || body.length > 0 && !framing.hasBody) {
      return this.#respond(client, 403, "Forbidden")
    }
    const approved = await this.#authority.authorizeBrowserUrl(url.href, this.#policy())
    const port = Number(url.port || 80)
    const upstream = await this.#dial(approved.addresses[0]!, port)
    const cleanHeaders = lines.filter((line) => !/^(?:host|connection|proxy-(?:authorization|connection)):/i.test(line))
    const request = Buffer.from(`${method} ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\n${cleanHeaders.join("\r\n")}\r\nConnection: close\r\n\r\n`, "latin1")
    upstream.write(request)
    if (framing.hasBody) {
      let receivedBytes = body.length
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          receivedBytes += chunk.length
          callback(receivedBytes > MAX_REQUEST_BODY_BYTES ? new Error("browser request body exceeds proxy limit") : null, chunk)
        },
      })
      if (body.length) limit.write(body)
      client.pipe(limit).pipe(upstream)
      limit.once("error", () => { client.destroy(); upstream.destroy() })
    } else if (body.length) {
      upstream.destroy()
      return this.#respond(client, 400, "Bad Request")
    }
    this.#relayResponse(client, upstream)
  }

  #dial(address: string, port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = this.#connect(address, port)
      socket.setTimeout(SOCKET_TIMEOUT_MS, () => socket.destroy(new Error("browser egress connect timed out")))
      socket.once("connect", () => { socket.setTimeout(0); resolve(socket) })
      socket.once("error", reject)
    })
  }

  #pipe(client: Socket, upstream: Socket): void {
    client.setTimeout(0)
    client.pipe(upstream)
    upstream.pipe(client)
    client.once("error", () => upstream.destroy())
    upstream.once("error", () => client.destroy())
    client.once("close", () => upstream.destroy())
    upstream.once("end", () => client.end())
    upstream.once("close", () => { if (!client.destroyed) client.end() })
    client.resume()
  }

  #relayResponse(client: Socket, upstream: Socket): void {
    client.setTimeout(0)
    upstream.pipe(client)
    upstream.once("end", () => client.end())
    upstream.once("error", () => client.destroy())
    client.once("error", () => upstream.destroy())
    client.once("close", () => upstream.destroy())
  }

  #respond(client: Socket, status: number, text: string): void {
    if (client.destroyed) return
    client.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    client.resume()
  }
}

function parseAuthority(authority: string, protocol: "http" | "https"): { url: string; port: number } {
  let url: URL
  try { url = new URL(`${protocol}://${authority}`) } catch { throw new Error("invalid browser proxy authority") }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("invalid browser proxy authority")
  return { url: url.href, port: Number(url.port || (protocol === "https" ? 443 : 80)) }
}

function requestBodyFraming(lines: readonly string[]): { hasBody: boolean; contentLength?: number } | undefined {
  const lengths = lines.filter((line) => /^content-length:/i.test(line))
  const transferEncodings = lines.filter((line) => /^transfer-encoding:/i.test(line))
  if (lengths.length > 1 || transferEncodings.length > 1 || lengths.length && transferEncodings.length) return undefined
  if (transferEncodings.length) {
    if (!/^transfer-encoding:\s*chunked\s*$/i.test(transferEncodings[0]!)) return undefined
    return { hasBody: true }
  }
  if (!lengths.length) return { hasBody: false }
  const match = /^content-length:\s*(\d+)\s*$/i.exec(lengths[0]!)
  if (!match) return undefined
  const contentLength = Number(match[1])
  if (!Number.isSafeInteger(contentLength)) return undefined
  return { hasBody: contentLength > 0, contentLength }
}
