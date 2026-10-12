/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { ACTION_CLASSES, type ActionClass } from "../../src/server/route-classes"
import { authorize, actionClassOf, levelOf, levelPerforms, type Level } from "../../src/server/route-authz"
import type { PrincipalVia, VerifiedPrincipal } from "../../src/server/auth-jwt"

const principal = (role: VerifiedPrincipal["role"], via: PrincipalVia = "bearer"): VerifiedPrincipal => ({
  id: `usr_${role}`,
  username: role,
  role,
  via,
})
const owner = principal("admin", "basic")

const LEVEL_OF: Record<Level, VerifiedPrincipal> = {
  viewer: principal("viewer"),
  member: principal("member"),
  admin: principal("admin"),
  owner,
}

const GATED = ACTION_CLASSES.filter((action): action is Exclude<ActionClass, "public"> => action !== "public")

function performs(level: Level): Exclude<ActionClass, "public">[] {
  return GATED.filter((action) => levelPerforms(level, action))
}

describe("the one capability table, by level", () => {
  test("a viewer performs the reads and nothing above them", () => {
    expect(performs("viewer").sort()).toEqual(["read-content", "read-metadata"])
  })

  test("a member also writes content and chats, and nothing above that", () => {
    expect(performs("member").sort()).toEqual(["read-content", "read-metadata", "write-content"])
  })

  test("an administrator also manages accounts and diagnostics, and runs no process and changes no credential", () => {
    expect(performs("admin").sort()).toEqual(["admin", "diagnostic", "read-content", "read-metadata", "write-content"])
  })

  test("the owner performs every class", () => {
    expect(performs("owner").sort()).toEqual([...GATED].sort())
  })

  test("the level of each principal follows its role, and the owner is the basic credential alone", () => {
    expect(levelOf(principal("viewer"))).toBe("viewer")
    expect(levelOf(principal("member"))).toBe("member")
    expect(levelOf(principal("admin", "bearer"))).toBe("admin")
    expect(levelOf(principal("admin", "ws-ticket"))).toBe("admin")
    expect(levelOf(owner)).toBe("owner")
    expect(levelOf(principal("member", "basic"))).toBe("member")
  })
})

describe("the owner is the operator's basic credential, in the admin role, and nothing else", () => {
  test("an admin access token performs no execute, credential or config route", () => {
    const admin = principal("admin", "bearer")
    for (const action of ["execute", "credential", "config"] as const) {
      expect(levelPerforms(levelOf(admin)!, action)).toBe(false)
    }
  })

  test("a WebSocket ticket of the owner is not the owner", () => {
    const ticket = principal("admin", "ws-ticket")
    expect(authorize({ method: "POST", path: "/pty", principal: ticket, passwordConfigured: true })).toBe(false)
  })

  test("the basic credential of a member role is not the owner", () => {
    expect(authorize({ method: "PATCH", path: "/global/config", principal: principal("member", "basic"), passwordConfigured: true })).toBe(false)
  })
})

describe("default deny", () => {
  test("a route with no entry is refused for every caller, the owner included", () => {
    for (const who of [owner, LEVEL_OF.admin, LEVEL_OF.member, LEVEL_OF.viewer]) {
      expect(authorize({ method: "POST", path: "/no/such/route", principal: who, passwordConfigured: true })).toBe(false)
    }
  })

  test("an unclassified GET of an API path is refused, and the interface's static paths are not", () => {
    expect(actionClassOf("GET", "/session/ses_1/unknown")).toBeUndefined()
    expect(authorize({ method: "GET", path: "/no/such/route", principal: owner, passwordConfigured: true })).toBe(false)
    expect(actionClassOf("GET", "/")).toBe("public")
    expect(actionClassOf("GET", "/assets/index-4f2a.js")).toBe("public")
  })

  test("the most literal entry answers first, so GET /debate/config is not GET /debate/:id", () => {
    expect(actionClassOf("GET", "/debate/config")).toBe("read-metadata")
    expect(actionClassOf("GET", "/debate/ses_1")).toBe("read-content")
  })

  test("an entry for another method does not answer", () => {
    expect(actionClassOf("POST", "/global/config")).toBeUndefined()
    expect(actionClassOf("PATCH", "/global/config")).toBe("config")
  })
})

describe("public routes and the no-password mode", () => {
  test("a public route is answered without a principal, password or not", () => {
    expect(authorize({ method: "POST", path: "/collab/login", principal: undefined, passwordConfigured: true })).toBe(true)
    expect(authorize({ method: "ALL", path: "/workbench/v1/files", principal: undefined, passwordConfigured: true })).toBe(true)
  })

  test("with no password configured, a request that carries no principal reaches a classified route, as before", () => {
    expect(authorize({ method: "POST", path: "/pty", principal: undefined, passwordConfigured: false })).toBe(true)
  })

  test("with a password configured, a request that carries no principal is refused", () => {
    expect(authorize({ method: "GET", path: "/config", principal: undefined, passwordConfigured: true })).toBe(false)
  })

  test("a verified principal is judged by its level, with or without a password", () => {
    const viewer = principal("viewer")
    expect(authorize({ method: "POST", path: "/pty", principal: viewer, passwordConfigured: false })).toBe(false)
    expect(authorize({ method: "POST", path: "/pty", principal: viewer, passwordConfigured: true })).toBe(false)
  })
})
