/* SPDX-License-Identifier: MIT */
/**
 * The decision of who is the owner of this installation, and the containment of the default vault.
 *
 * These are pure functions: each case is a request as the server sees it, without a network.
 */
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { decideOwner, isInsideDirectory, isLoopbackAddress } from "../../src/server/knowledge-authority"

const ADMIN = { role: "admin" }
const MEMBER = { role: "member" }
const VIEWER = { role: "viewer" }

describe("decideOwner", () => {
  test("an admin principal is the owner, with credentials configured or not", () => {
    expect(decideOwner({ user: ADMIN, passwordConfigured: true, clientAddress: "203.0.113.7" })).toEqual({
      owner: true,
      via: "admin",
    })
    expect(decideOwner({ user: ADMIN, passwordConfigured: false, clientAddress: null })).toEqual({
      owner: true,
      via: "admin",
    })
  })

  test("a verified principal of another role is refused, even on loopback", () => {
    for (const user of [MEMBER, VIEWER]) {
      expect(decideOwner({ user, passwordConfigured: true, clientAddress: "127.0.0.1" })).toEqual({
        owner: false,
        refusal: "insufficient-role",
      })
    }
  })

  test("with credentials configured, a request without a principal is refused", () => {
    expect(decideOwner({ user: undefined, passwordConfigured: true, clientAddress: "127.0.0.1" })).toEqual({
      owner: false,
      refusal: "unauthenticated",
    })
  })

  test("without credentials, a loopback request is the local operator", () => {
    for (const address of ["127.0.0.1", "127.10.0.2", "::1", "::ffff:127.0.0.1"]) {
      expect(decideOwner({ user: undefined, passwordConfigured: false, clientAddress: address })).toEqual({
        owner: true,
        via: "local",
      })
    }
  })

  test("without credentials, any other address is refused, and so is an unknown one", () => {
    for (const address of ["192.168.1.10", "10.0.0.5", "203.0.113.7", "::ffff:192.168.1.10", "127.0.0.1.evil.example", null]) {
      expect(decideOwner({ user: undefined, passwordConfigured: false, clientAddress: address })).toEqual({
        owner: false,
        refusal: "remote-unsecured",
      })
    }
  })

  test("a header cannot make a request the owner: the decision never reads one", () => {
    // The only inputs are the verified principal, the configuration and the peer address.
    const decision = decideOwner({ user: undefined, passwordConfigured: true, clientAddress: "127.0.0.1" })
    expect(decision.owner).toBe(false)
  })
})

describe("isLoopbackAddress", () => {
  test("accepts only the loopback interface", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true)
    expect(isLoopbackAddress("::1")).toBe(true)
    expect(isLoopbackAddress("0.0.0.0")).toBe(false)
    expect(isLoopbackAddress("::")).toBe(false)
    expect(isLoopbackAddress(null)).toBe(false)
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
