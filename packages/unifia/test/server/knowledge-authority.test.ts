/* SPDX-License-Identifier: MIT */
/**
 * The decisions that bound who may read the vault, as pure functions over the request as the server
 * sees it: the verified principal, the Host and Origin headers, and the port. No network is used.
 */
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { decideOwner, isInsideDirectory, isTrustedRequestTarget } from "../../src/server/knowledge-authority"

const PORT = 4096
const target = (overrides: Partial<{ host: string | null; origin: string | null; serverPort: number | undefined }>) => ({
  host: `127.0.0.1:${PORT}`,
  origin: null,
  serverPort: PORT,
  ...overrides,
})

describe("decideOwner", () => {
  test("only a verified admin principal is the owner", () => {
    expect(decideOwner({ user: { role: "admin" } })).toEqual({ owner: true, via: "admin" })
  })

  test("another verified role is refused", () => {
    for (const role of ["member", "viewer"]) {
      expect(decideOwner({ user: { role } })).toEqual({ owner: false, refusal: "insufficient-role" })
    }
  })

  test("no verified principal is refused: the loopback interface is not an identity", () => {
    expect(decideOwner({ user: undefined })).toEqual({ owner: false, refusal: "unauthenticated" })
  })
})

describe("isTrustedRequestTarget: Host", () => {
  test("loopback names and IP literals are trusted, with the server's port", () => {
    expect(isTrustedRequestTarget(target({ host: `127.0.0.1:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ host: `localhost:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ host: `[::1]:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ host: "192.168.1.20:4096" }))).toBe(true)
  })

  test("a host name is refused, because it is how DNS rebinding reaches a local server", () => {
    expect(isTrustedRequestTarget(target({ host: `evil.example:${PORT}` }))).toBe(false)
    expect(isTrustedRequestTarget(target({ host: `localhost.evil.example:${PORT}` }))).toBe(false)
    expect(isTrustedRequestTarget(target({ host: `127.0.0.1.evil.example:${PORT}` }))).toBe(false)
  })

  test("a missing Host is refused", () => {
    expect(isTrustedRequestTarget(target({ host: null }))).toBe(false)
  })
})

describe("isTrustedRequestTarget: Origin", () => {
  test("a request without an Origin is a native client and is trusted", () => {
    expect(isTrustedRequestTarget(target({ origin: null }))).toBe(true)
  })

  test("the application's own origins are trusted: desktop webviews and the development server", () => {
    for (const origin of ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420"]) {
      expect(isTrustedRequestTarget(target({ origin }))).toBe(true)
    }
  })

  test("the server's own origin on its port is trusted, and another port is not", () => {
    expect(isTrustedRequestTarget(target({ origin: `http://127.0.0.1:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ origin: `http://localhost:${PORT}` }))).toBe(true)
    expect(isTrustedRequestTarget(target({ origin: `http://localhost:3000` }))).toBe(false)
  })

  test("a page from any other origin is refused, including the literal null origin", () => {
    expect(isTrustedRequestTarget(target({ origin: "https://evil.example" }))).toBe(false)
    expect(isTrustedRequestTarget(target({ origin: "http://127.0.0.1:9999" }))).toBe(false)
    expect(isTrustedRequestTarget(target({ origin: "null" }))).toBe(false)
  })

  test("without the server's port, only the application origins are trusted", () => {
    expect(isTrustedRequestTarget(target({ serverPort: undefined, origin: `http://127.0.0.1:${PORT}` }))).toBe(false)
    expect(isTrustedRequestTarget(target({ serverPort: undefined, origin: "tauri://localhost" }))).toBe(true)
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
