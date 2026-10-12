/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { ACTION_CLASSES, type ActionClass } from "../../src/server/route-classes"
import {
  authorize,
  actionClassOf,
  levelOf,
  levelPerforms,
  type AuthorizationInput,
  type Level,
} from "../../src/server/route-authz"
import type { PrincipalVia, VerifiedPrincipal } from "../../src/server/auth-jwt"

const OWN = "/srv/project"

/** The boundary's decision for a request that names the server's own directory unless the input says otherwise. */
function allowed(input: Partial<AuthorizationInput> & Pick<AuthorizationInput, "method" | "path" | "principal" | "passwordConfigured">): boolean {
  return authorize({ directory: undefined, workspace: false, ownDirectory: OWN, ...input })
}

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
    expect(allowed({ method: "POST", path: "/pty", principal: ticket, passwordConfigured: true })).toBe(false)
  })

  test("the basic credential of a member role is not the owner", () => {
    expect(
      allowed({ method: "PATCH", path: "/global/config", principal: principal("member", "basic"), passwordConfigured: true }),
    ).toBe(false)
  })
})

describe("default deny", () => {
  test("a route with no entry is refused for every caller, the owner included", () => {
    for (const who of [owner, LEVEL_OF.admin, LEVEL_OF.member, LEVEL_OF.viewer]) {
      expect(allowed({ method: "POST", path: "/no/such/route", principal: who, passwordConfigured: true })).toBe(false)
    }
  })

  test("an unclassified GET of an API path is refused, and the interface's static paths are not", () => {
    expect(actionClassOf("GET", "/session/ses_1/unknown")).toBeUndefined()
    expect(allowed({ method: "GET", path: "/no/such/route", principal: owner, passwordConfigured: true })).toBe(false)
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
    expect(allowed({ method: "POST", path: "/collab/login", principal: undefined, passwordConfigured: true })).toBe(true)
    expect(allowed({ method: "ALL", path: "/workbench/v1/files", principal: undefined, passwordConfigured: true })).toBe(true)
  })

  test("with no password configured, a request that carries no principal reaches a classified route, as before", () => {
    expect(allowed({ method: "POST", path: "/pty", principal: undefined, passwordConfigured: false })).toBe(true)
    expect(
      allowed({ method: "GET", path: "/session", principal: undefined, passwordConfigured: false, directory: "/elsewhere" }),
    ).toBe(true)
  })

  test("with a password configured, a request that carries no principal is refused", () => {
    expect(allowed({ method: "GET", path: "/config", principal: undefined, passwordConfigured: true })).toBe(false)
  })

  test("a verified principal is judged by its level, with or without a password", () => {
    const viewer = principal("viewer")
    expect(allowed({ method: "POST", path: "/pty", principal: viewer, passwordConfigured: false })).toBe(false)
    expect(allowed({ method: "POST", path: "/pty", principal: viewer, passwordConfigured: true })).toBe(false)
  })
})

describe("the directory a caller other than the owner works in", () => {
  test("the server's own directory is answered, named or not", () => {
    expect(allowed({ method: "GET", path: "/session", principal: LEVEL_OF.member, passwordConfigured: true })).toBe(true)
    expect(
      allowed({ method: "GET", path: "/session", principal: LEVEL_OF.member, passwordConfigured: true, directory: OWN }),
    ).toBe(true)
  })

  test("another directory is refused for a viewer, a member and an admin account", () => {
    for (const who of [LEVEL_OF.viewer, LEVEL_OF.member, LEVEL_OF.admin]) {
      expect(
        allowed({ method: "GET", path: "/session", principal: who, passwordConfigured: true, directory: "/srv/other" }),
      ).toBe(false)
    }
  })

  test("a workspace, which selects another directory, is refused for a non-owner", () => {
    expect(allowed({ method: "GET", path: "/session", principal: LEVEL_OF.member, passwordConfigured: true, workspace: true })).toBe(false)
  })

  test("the owner names any directory and any workspace", () => {
    expect(
      allowed({ method: "GET", path: "/session", principal: owner, passwordConfigured: true, directory: "/srv/other", workspace: true }),
    ).toBe(true)
  })

  test("the rule holds on the outer routes too: a directory named to a global route is refused the same way", () => {
    expect(
      allowed({ method: "GET", path: "/global/config", principal: LEVEL_OF.viewer, passwordConfigured: true, directory: "/srv/other" }),
    ).toBe(false)
    expect(
      allowed({ method: "GET", path: "/global/config", principal: LEVEL_OF.viewer, passwordConfigured: true, directory: OWN }),
    ).toBe(true)
  })

  test("a public route is not judged by the directory", () => {
    expect(allowed({ method: "POST", path: "/collab/login", principal: undefined, passwordConfigured: true, directory: "/srv/other" })).toBe(true)
  })
})
