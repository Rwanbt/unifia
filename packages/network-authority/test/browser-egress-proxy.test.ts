/* SPDX-License-Identifier: MIT */
import { afterEach, describe, expect, test } from "bun:test"
import { createServer, createConnection, type Server } from "node:net"
import { BrowserEgressProxy } from "../src/browser-egress-proxy.ts"
import { NetworkAuthority } from "../src/index.ts"

const servers: Server[] = []
const proxies: BrowserEgressProxy[] = []

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe("BrowserEgressProxy", () => {
  test("forwards bounded POST form bodies through the authorized origin", async () => {
    let received = ""
    const formBody = `${"x".repeat(64 * 1024)}&submit=yes`
    const upstream = createServer((socket) => socket.on("data", (chunk) => {
      received += chunk.toString("latin1")
      if (!received.endsWith("&submit=yes")) return
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
    }))
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const proxy = new BrowserEgressProxy({
      policy: { allowedOrigins: ["http://example.test"], blockThirdPartyCookies: true, defaultDeny: true },
      authority: new NetworkAuthority(async () => ["93.184.216.34"]),
      connect: () => createConnection({ host: "127.0.0.1", port: upstreamPort }),
    })
    proxies.push(proxy)

    const response = await request(await proxy.start(), "http://example.test/submit", "POST", formBody)

    expect(response).toContain("200 OK")
    expect(response.endsWith("ok")).toBe(true)
    expect(received).toContain("POST /submit HTTP/1.1")
    expect(received).toContain(formBody)
  })

  test("rejects ambiguous or oversized request body framing before dialing", async () => {
    const dialed: string[] = []
    const proxy = new BrowserEgressProxy({
      policy: { allowedOrigins: ["http://example.test"], blockThirdPartyCookies: true, defaultDeny: true },
      authority: new NetworkAuthority(async () => ["93.184.216.34"]),
      connect: (address, port) => {
        dialed.push(`${address}:${port}`)
        return createConnection({ host: address, port })
      },
    })
    proxies.push(proxy)
    const proxyUrl = await proxy.start()
    const ambiguous = await requestRaw(proxyUrl, "POST http://example.test/submit HTTP/1.1\r\nHost: example.test\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n")
    const oversized = await requestRaw(proxyUrl, "POST http://example.test/submit HTTP/1.1\r\nHost: example.test\r\nContent-Length: 16777217\r\n\r\n")

    expect(ambiguous).toContain("403 Forbidden")
    expect(oversized).toContain("403 Forbidden")
    expect(dialed).toEqual([])
  })

  test("dials the exact public address authorized by NetworkAuthority", async () => {
    const upstream = createServer((socket) => { socket.on("data", () => undefined); setTimeout(() => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"), 10) })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const dialed: string[] = []
    const proxy = new BrowserEgressProxy({
      policy: { allowedOrigins: ["http://example.test"], blockThirdPartyCookies: true, defaultDeny: true },
      authority: new NetworkAuthority(async () => ["93.184.216.34"]),
      connect: (address, _port) => {
        dialed.push(address)
        return createConnection({ host: "127.0.0.1", port: upstreamPort })
      },
    })
    proxies.push(proxy)
    const proxyAddress = await proxy.start()
    const response = await request(proxyAddress, "http://example.test/report")

    expect(response).toContain("200 OK")
    expect(response.endsWith("ok")).toBe(true)
    expect(dialed).toEqual(["93.184.216.34"])
  })

  test("reads session egress grants dynamically and denies an origin until it is approved", async () => {
    const upstream = createServer((socket) => { socket.on("data", () => undefined); setTimeout(() => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"), 10) })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const allowedOrigins: string[] = []
    const dialed: string[] = []
    const denials: string[] = []
    const proxy = new BrowserEgressProxy({
      policy: () => ({ allowedOrigins, blockThirdPartyCookies: true, defaultDeny: true }),
      authority: new NetworkAuthority(async () => ["93.184.216.34"]),
      onDenied: (code) => denials.push(code),
      connect: (address, _port) => {
        dialed.push(address)
        return createConnection({ host: "127.0.0.1", port: upstreamPort })
      },
    })
    proxies.push(proxy)
    const proxyUrl = await proxy.start()

    const denied = await request(proxyUrl, "http://example.test/report")
    expect(denied).toContain("403 Forbidden")
    expect(dialed).toEqual([])
    expect(denials).toEqual(["origin-denied"])

    allowedOrigins.push("http://example.test")
    const allowed = await request(proxyUrl, "http://example.test/report")
    expect(allowed).toContain("200 OK")
    expect(dialed).toEqual(["93.184.216.34"])
  })

  test("reads a fragmented HTTP request header before applying policy", async () => {
    const upstream = createServer((socket) => { socket.on("data", () => undefined); setTimeout(() => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"), 10) })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const proxy = new BrowserEgressProxy({
      policy: { allowedOrigins: ["http://example.test"], blockThirdPartyCookies: true, defaultDeny: true },
      authority: new NetworkAuthority(async () => ["93.184.216.34"]),
      connect: () => createConnection({ host: "127.0.0.1", port: upstreamPort }),
    })
    proxies.push(proxy)
    const response = await fragmentedRequest(await proxy.start(), [
      "GET http://example.test/report HTTP/1.1\r\nHost: example.test\r\n",
      "User-Agent: fragmented-client\r\nConnection: close\r\n\r\n",
    ])

    expect(response).toContain("200 OK")
    expect(response.endsWith("ok")).toBe(true)
  })

  test("refuses an origin that resolves to a private address without dialing", async () => {
    const dialed: string[] = []
    const proxy = new BrowserEgressProxy({
      policy: { allowedOrigins: ["http://private.test"], blockThirdPartyCookies: true, defaultDeny: true },
      authority: new NetworkAuthority(async () => ["127.0.0.1"]),
      connect: (address, port) => {
        dialed.push(`${address}:${port}`)
        return createConnection({ host: address, port })
      },
    })
    proxies.push(proxy)
    const response = await request(await proxy.start(), "http://private.test/metadata")

    expect(response).toContain("403 Forbidden")
    expect(dialed).toEqual([])
  })

  test("revalidates a redirected destination before opening its connection", async () => {
    const upstream = createServer((socket) => {
      socket.on("data", () => socket.end("HTTP/1.1 302 Found\r\nLocation: http://private.test/metadata\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"))
    })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const dialed: string[] = []
    const proxy = new BrowserEgressProxy({
      policy: { allowedOrigins: ["*"], blockThirdPartyCookies: true, defaultDeny: true },
      authority: new NetworkAuthority(async (hostname) => hostname === "private.test" ? ["169.254.169.254"] : ["93.184.216.34"]),
      connect: (address, _port) => {
        dialed.push(address)
        return createConnection({ host: "127.0.0.1", port: upstreamPort })
      },
    })
    proxies.push(proxy)
    const proxyUrl = await proxy.start()
    const firstResponse = await request(proxyUrl, "http://public.test/start")
    const redirectedResponse = await request(proxyUrl, "http://private.test/metadata")

    expect(firstResponse).toContain("302 Found")
    expect(redirectedResponse).toContain("403 Forbidden")
    expect(dialed).toEqual(["93.184.216.34"])
  })

  test("refuses numeric and DNS-resolved loopback destinations without dialing", async () => {
    const dialed: string[] = []
    const proxy = new BrowserEgressProxy({
      policy: { allowedOrigins: ["*"], blockThirdPartyCookies: true, defaultDeny: true },
      authority: new NetworkAuthority(async (hostname) => hostname === "localhost" ? ["::1"] : []),
      connect: (address, port) => {
        dialed.push(`${address}:${port}`)
        return createConnection({ host: address, port })
      },
    })
    proxies.push(proxy)
    const proxyUrl = await proxy.start()
    const ipv4Response = await request(proxyUrl, "http://127.0.0.1/metadata")
    const localhostResponse = await request(proxyUrl, "http://localhost/metadata")

    expect(ipv4Response).toContain("403 Forbidden")
    expect(localhostResponse).toContain("403 Forbidden")
    expect(dialed).toEqual([])
  })

  test("pins an HTTPS CONNECT tunnel to the authorized address", async () => {
    const upstream = createServer((socket) => socket.on("data", () => socket.write("pong")))
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const dialed: string[] = []
    const proxy = new BrowserEgressProxy({
      policy: { allowedOrigins: ["https://example.test"], blockThirdPartyCookies: true, defaultDeny: true },
      authority: new NetworkAuthority(async () => ["93.184.216.34"]),
      connect: (address) => {
        dialed.push(address)
        return createConnection({ host: "127.0.0.1", port: upstreamPort })
      },
    })
    proxies.push(proxy)
    const reply = await tunnel(await proxy.start())

    expect(reply).toContain("200 Connection Established")
    expect(reply.endsWith("pong")).toBe(true)
    expect(dialed).toEqual(["93.184.216.34"])
  })

  test("revokes established HTTPS tunnels immediately when session policy changes", async () => {
    const upstream = createServer((socket) => socket.on("data", () => undefined))
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const proxy = new BrowserEgressProxy({
      policy: { allowedOrigins: ["https://example.test"], blockThirdPartyCookies: true, defaultDeny: true },
      authority: new NetworkAuthority(async () => ["93.184.216.34"]),
      connect: () => createConnection({ host: "127.0.0.1", port: upstreamPort }),
    })
    proxies.push(proxy)
    const address = new URL(await proxy.start())
    let response = ""
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: address.hostname, port: Number(address.port) })
      socket.on("data", (chunk) => {
        response += chunk.toString("latin1")
        if (response.includes("\r\n\r\n")) proxy.revokeConnections()
      })
      socket.once("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolve()
        else reject(error)
      })
      socket.once("close", resolve)
      socket.once("connect", () => socket.write("CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n"))
    })

    expect(response).toContain("200 Connection Established")
  })
})

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("test server did not bind"))
      resolve(address.port)
    })
  })
}

function request(proxyUrl: string, target: string, method = "GET", body = ""): Promise<string> {
  const length = body ? `Content-Length: ${Buffer.byteLength(body)}\r\n` : ""
  return requestRaw(proxyUrl, `${method} ${target} HTTP/1.1\r\nHost: ${new URL(target).host}\r\n${length}Connection: close\r\n\r\n${body}`)
}

function requestRaw(proxyUrl: string, requestText: string): Promise<string> {
  const address = new URL(proxyUrl)
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: address.hostname, port: Number(address.port) })
    let response = ""
    socket.on("data", (chunk) => { response += chunk.toString("latin1") })
    socket.once("error", reject)
    socket.once("close", () => resolve(response))
    socket.once("connect", () => socket.write(requestText))
  })
}

function fragmentedRequest(proxyUrl: string, chunks: readonly string[]): Promise<string> {
  const address = new URL(proxyUrl)
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: address.hostname, port: Number(address.port) })
    let response = ""
    socket.on("data", (chunk) => { response += chunk.toString("latin1") })
    socket.once("error", reject)
    socket.once("close", () => resolve(response))
    socket.once("connect", () => {
      socket.write(chunks[0]!)
      setTimeout(() => socket.write(chunks[1]!), 10)
    })
  })
}

function tunnel(proxyUrl: string): Promise<string> {
  const address = new URL(proxyUrl)
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: address.hostname, port: Number(address.port) })
    let reply = ""
    let payloadSent = false
    const timeout = setTimeout(() => socket.destroy(), 2_000)
    socket.on("data", (chunk) => {
      reply += chunk.toString("latin1")
      if (!payloadSent && reply.includes("\r\n\r\n")) {
        payloadSent = true
        socket.write("ping")
      } else if (payloadSent && reply.endsWith("pong")) {
        clearTimeout(timeout)
        socket.end()
      }
    })
    socket.once("error", (error) => { clearTimeout(timeout); reject(error) })
    socket.once("close", () => { clearTimeout(timeout); resolve(reply) })
    socket.once("connect", () => socket.write("CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n"))
  })
}
