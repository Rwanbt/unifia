/* SPDX-License-Identifier: MIT */
/**
 * The origins a server answers on, from its bound address and port. They are the server's own page's origins, and the
 * origin gate trusts them. Nothing here is read from a request: a request names whatever host it likes.
 */
import { describe, expect, test } from "bun:test"
import { servedOrigins } from "../../src/server/browser-origin"

const LOOPBACK = ["http://localhost:4096", "http://127.0.0.1:4096", "http://[::1]:4096"]
const noMachineAddresses = () => {
  throw new Error("the machine's addresses are read only for a wildcard bind")
}

describe("servedOrigins: a server bound to one address", () => {
  test("answers on that address and on the loopback names, with its scheme and port", () => {
    const origins = servedOrigins({ scheme: "http", hostname: "192.168.1.20", port: 4096 }, noMachineAddresses)
    expect(origins).toContain("http://192.168.1.20:4096")
    for (const origin of LOOPBACK) expect(origins).toContain(origin)
    expect(origins).toHaveLength(LOOPBACK.length + 1)
  })

  test("a loopback bind answers on loopback only, and does not read the machine's addresses", () => {
    const origins = servedOrigins({ scheme: "http", hostname: "127.0.0.1", port: 4096 }, noMachineAddresses)
    expect(origins).toEqual(expect.arrayContaining(LOOPBACK))
    expect(origins.every((origin) => origin.endsWith(":4096"))).toBe(true)
  })

  test("an IPv6 address is written in brackets, as a browser's Origin writes it", () => {
    const origins = servedOrigins({ scheme: "http", hostname: "fe80::1", port: 4096 }, noMachineAddresses)
    expect(origins).toContain("http://[fe80::1]:4096")
  })

  test("a TLS server answers on https, not http", () => {
    const origins = servedOrigins({ scheme: "https", hostname: "192.168.1.20", port: 4096 }, noMachineAddresses)
    expect(origins).toContain("https://192.168.1.20:4096")
    expect(origins).not.toContain("http://192.168.1.20:4096")
  })
})

describe("servedOrigins: a server bound to every interface", () => {
  test("answers on each address of this machine, and never on the wildcard itself", () => {
    const origins = servedOrigins({ scheme: "http", hostname: "0.0.0.0", port: 4096 }, () => [
      "192.168.1.20",
      "10.0.0.7",
      "fe80::1",
    ])
    expect(origins).toContain("http://192.168.1.20:4096")
    expect(origins).toContain("http://10.0.0.7:4096")
    expect(origins).toContain("http://[fe80::1]:4096")
    expect(origins).not.toContain("http://0.0.0.0:4096")
    for (const origin of LOOPBACK) expect(origins).toContain(origin)
  })

  test("the IPv6 wildcard is handled the same way", () => {
    const origins = servedOrigins({ scheme: "http", hostname: "::", port: 4096 }, () => ["192.168.1.20"])
    expect(origins).toContain("http://192.168.1.20:4096")
    expect(origins).not.toContain("http://[::]:4096")
  })
})
