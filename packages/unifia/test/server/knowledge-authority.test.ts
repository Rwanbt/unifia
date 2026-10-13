/* SPDX-License-Identifier: MIT */
/**
 * The decisions that bound who may read the vault, as pure functions over the request as the server
 * sees it: the verified principal, the Host and Origin headers, the port and the machine's addresses.
 * No network is used.
 */
import { describe, expect, test } from "bun:test"
import path from "node:path"
import type { VerifiedPrincipal } from "../../src/server/auth-jwt"
import {
  decideOwner,
  isInsideDirectory,
  isTrustedRequestTarget,
  machineAddresses,
} from "../../src/server/knowledge-authority"

const PORT = 4096
/** The addresses of a machine on a local network, as the operating system reports them. */
const LOCAL = new Set(["127.0.0.1", "::1", "192.168.1.20", "fe80::1"])

const target = (overrides: Partial<{ host: string | null; origin: string | null; serverPort: number | undefined }>) => ({
  host: `127.0.0.1:${PORT}`,
  origin: null,
  serverPort: PORT,
  localAddresses: LOCAL,
  ...overrides,
})

/** A verified principal. The default is the operator: the basic credential, in the admin role. */
const principal = (overrides: Partial<VerifiedPrincipal> = {}): VerifiedPrincipal => ({
  id: "basic-auth",
  username: "operator",
  role: "admin",
  via: "basic",
  ...overrides,
})

describe("decideOwner", () => {
  test("the operator's basic credential, in the admin role, is the owner", () => {
    expect(decideOwner({ user: principal() })).toEqual({ owner: true, via: "operator" })
  })

  test("an access token of an admin account is not the owner: admin is a role, not the owner", () => {
    const admin = principal({ id: "user-1", username: "ada", via: "bearer" })
    expect(decideOwner({ user: admin })).toEqual({ owner: false, refusal: "not-operator" })
  })

  test("a WebSocket ticket is not the owner, even when it was issued to an admin", () => {
    const admin = principal({ id: "user-1", username: "ada", via: "ws-ticket" })
    expect(decideOwner({ user: admin })).toEqual({ owner: false, refusal: "not-operator" })
  })

  test("another role is refused, whichever credential presented it", () => {
    for (const role of ["member", "viewer"] as const) {
      for (const via of ["basic", "bearer", "ws-ticket"] as const) {
        const user = principal({ id: "user-2", username: "bob", role, via })
        expect(decideOwner({ user })).toEqual({ owner: false, refusal: "not-operator" })
      }
    }
  })

  test("no verified principal is refused: the loopback interface is not an identity", () => {
    expect(decideOwner({ user: undefined })).toEqual({ owner: false, refusal: "unauthenticated" })
  })
})

describe("isTrustedRequestTarget: Host, accepted", () => {
  test("localhost and the loopback block, on the server's port", () => {
    expect(isTrustedRequestTarget(target({ host: `127.0.0.1:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ host: `127.0.0.2:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ host: `localhost:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ host: `[::1]:${PORT}` }))).toBe(true)
  })

  test("an address this machine has on one of its interfaces, for access from the local network", () => {
    expect(isTrustedRequestTarget(target({ host: `192.168.1.20:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ host: `[fe80::1]:${PORT}` }))).toBe(true)
  })
})

describe("isTrustedRequestTarget: Host, refused", () => {
  test("a host name is refused, as DNS rebinding would send it", () => {
    expect(isTrustedRequestTarget(target({ host: `evil.example:${PORT}` }))).toBe(false)
    expect(isTrustedRequestTarget(target({ host: `localhost.evil.example:${PORT}` }))).toBe(false)
    expect(isTrustedRequestTarget(target({ host: `127.0.0.1.evil.example:${PORT}` }))).toBe(false)
  })

  test("an IP literal this machine does not have is refused, even when it is well formed", () => {
    expect(isTrustedRequestTarget(target({ host: `203.0.113.9:${PORT}` }))).toBe(false)
    expect(isTrustedRequestTarget(target({ host: `10.0.0.5:${PORT}` }))).toBe(false)
    expect(isTrustedRequestTarget(target({ host: `[2001:db8::9]:${PORT}` }))).toBe(false)
  })

  test("a malformed or ambiguous IPv4 literal is refused", () => {
    expect(isTrustedRequestTarget(target({ host: `127.0.0.01:${PORT}` }))).toBe(false) // leading zero
    expect(isTrustedRequestTarget(target({ host: `999.0.0.1:${PORT}` }))).toBe(false) // octet out of range
    expect(isTrustedRequestTarget(target({ host: `127.0.0.1.1:${PORT}` }))).toBe(false) // five octets
    expect(isTrustedRequestTarget(target({ host: `127.0.0:${PORT}` }))).toBe(false) // three octets
    expect(isTrustedRequestTarget(target({ host: `0.0.0.0:${PORT}` }))).toBe(false) // unspecified, not an interface
  })

  test("the port must be exactly the server's: another port, or none, is refused", () => {
    expect(isTrustedRequestTarget(target({ host: "127.0.0.1:9999" }))).toBe(false)
    expect(isTrustedRequestTarget(target({ host: "127.0.0.1" }))).toBe(false)
    expect(isTrustedRequestTarget(target({ host: "[::1]" }))).toBe(false)
  })

  test("a missing Host is refused, and so is a server whose port is unknown", () => {
    expect(isTrustedRequestTarget(target({ host: null }))).toBe(false)
    expect(isTrustedRequestTarget(target({ serverPort: undefined }))).toBe(false)
  })
})

describe("isTrustedRequestTarget: Origin", () => {
  test("a request without an Origin is a native client and is trusted", () => {
    expect(isTrustedRequestTarget(target({ origin: null }))).toBe(true)
  })

  test("the desktop webviews, on each platform, are trusted", () => {
    for (const origin of ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]) {
      expect(isTrustedRequestTarget(target({ origin }))).toBe(true)
    }
  })

  test("the development server is trusted", () => {
    expect(isTrustedRequestTarget(target({ origin: "http://localhost:1420" }))).toBe(true)
  })

  test("this server's own origin on its port is trusted, in each spelling of loopback", () => {
    expect(isTrustedRequestTarget(target({ origin: `http://127.0.0.1:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ origin: `http://localhost:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ origin: `http://[::1]:${PORT}` }))).toBe(true)
  })

  test("a page from any other origin is refused, including look-alikes and the literal null", () => {
    expect(isTrustedRequestTarget(target({ origin: "https://evil.example" }))).toBe(false)
    expect(isTrustedRequestTarget(target({ origin: `http://evil.example:${PORT}` }))).toBe(false)
    expect(isTrustedRequestTarget(target({ origin: "https://tauri.localhost.evil.example" }))).toBe(false)
    expect(isTrustedRequestTarget(target({ origin: "tauri://evil" }))).toBe(false)
    expect(isTrustedRequestTarget(target({ origin: "http://localhost:3000" }))).toBe(false)
    expect(isTrustedRequestTarget(target({ origin: "http://127.0.0.1:9999" }))).toBe(false)
    expect(isTrustedRequestTarget(target({ origin: "null" }))).toBe(false)
  })
})

describe("machineAddresses", () => {
  test("collects every interface address, loopback included, without duplicates", () => {
    const addresses = machineAddresses({
      lo: [{ address: "127.0.0.1" } as never, { address: "::1" } as never],
      eth0: [{ address: "192.168.1.20" } as never, { address: "192.168.1.20" } as never],
      unused: undefined,
    })
    expect([...addresses].sort()).toEqual(["127.0.0.1", "192.168.1.20", "::1"])
  })

  test("reads the real interfaces when none are given, and includes the loopback", () => {
    expect(machineAddresses().has("127.0.0.1")).toBe(true)
  })
})

describe("decideOwner and Host together", () => {
  test("a trusted target alone grants nothing: the owner is still the verified operator", () => {
    expect(isTrustedRequestTarget(target({}))).toBe(true)
    expect(decideOwner({ user: undefined }).owner).toBe(false)
  })
})

describe("isInsideDirectory", () => {
  const project = path.resolve("/work/project")

  test("the project and anything under it are inside", () => {
    expect(isInsideDirectory(project, project)).toBe(true)
    expect(isInsideDirectory(path.join(project, ".unifia", "memory"), project)).toBe(true)
  })

  test("a sibling that shares a prefix, a parent, and an escaping path are outside", () => {
    expect(isInsideDirectory(path.resolve("/work/project-other"), project)).toBe(false)
    expect(isInsideDirectory(path.resolve("/work"), project)).toBe(false)
    expect(isInsideDirectory(path.join(project, "..", "secret"), project)).toBe(false)
  })

  test("a directory whose name starts with two dots is inside, not an escape", () => {
    expect(isInsideDirectory(path.join(project, "..cache"), project)).toBe(true)
  })
})
