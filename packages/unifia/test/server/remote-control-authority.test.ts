/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { chmodSync } from "node:fs"
import path from "node:path"
import { Flag } from "../../src/flag/flag"
import { JwtAuth } from "../../src/server/auth-jwt"
import { classify, permitted } from "../../src/server/route-authority"
import { Server } from "../../src/server/server"
import { User } from "../../src/user"
import { tmpdir } from "../fixture/fixture"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"

const PASSWORD = "remote-authority-test-operator"
let saved: string | undefined
let server: InProcessServer
const tokens = new Map<string, string>()

beforeAll(async () => {
  saved = Flag.UNIFIA_SERVER_PASSWORD
  // @ts-expect-error test-only override
  Flag.UNIFIA_SERVER_PASSWORD = PASSWORD
  server = await withInProcessServer({ password: PASSWORD })
  for (const role of ["viewer", "member", "admin"] as const) {
    const user = await User.register({ username: `remote-authority-${role}`, password: PASSWORD, role })
    tokens.set(role, `Bearer ${JwtAuth.issue(user).accessToken}`)
  }
})

afterAll(async () => {
  await server.close()
  // @ts-expect-error restore test-only override
  Flag.UNIFIA_SERVER_PASSWORD = saved
})

function token(role: "viewer" | "member" | "admin"): string {
  return tokens.get(role)!
}

function command(directory: string, authorization: string) {
  return server.fetch(`/tui/execute-command?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ command: "messages_first" }),
  })
}

describe("remote device-control route authority", () => {
  test("a signed viewer or member cannot issue TUI commands or read terminals", async () => {
    await using project = await tmpdir({ git: true })
    for (const role of ["viewer", "member"] as const) {
      expect((await command(project.path, token(role))).status).toBe(403)
      expect(
        (await server.fetch(`/pty?directory=${encodeURIComponent(project.path)}`, { headers: { Authorization: token(role) } })).status,
      ).toBe(403)
    }
  })

  test("a viewer cannot write operator configuration, even with a valid access token", async () => {
    const response = await server.fetch("/global/config", {
      method: "PATCH",
      headers: { Authorization: token("viewer"), "Content-Type": "application/json" },
      body: "{}",
    })
    expect(response.status).toBe(403)
    expect((await server.fetch("/global/config", { headers: { Authorization: token("viewer") } })).status).toBe(200)
  })

  test("a viewer cannot create project content while a member can", async () => {
    await using project = await tmpdir({ git: true })
    const file = path.join(project.path, "role-matrix.txt")
    const write = (role: "viewer" | "member") =>
      server.fetch(`/file/write?directory=${encodeURIComponent(project.path)}`, {
        method: "POST",
        headers: { Authorization: token(role), "Content-Type": "application/json" },
        body: JSON.stringify({ path: "role-matrix.txt", content: "member may write" }),
      })
    expect((await write("viewer")).status).toBe(403)
    expect(await Bun.file(file).exists()).toBe(false)
    expect((await write("member")).status).toBe(200)
    expect(await Bun.file(file).text()).toBe("member may write")
  })

  test("Git clean filters, commit hooks and checkout hooks require admin, with no denied effects", async () => {
    await using project = await tmpdir({ git: true })
    const dir = project.path
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim()
    const marker = (name: string) => Bun.file(path.join(dir, ".git", name)).exists()
    const hook = async (name: string, body: string) => {
      const file = path.join(dir, ".git", "hooks", name)
      await Bun.write(file, `#!/bin/sh\n${body}\n`)
      chmodSync(file, 0o755)
    }
    await Bun.write(path.join(dir, ".gitattributes"), "payload.txt filter=probe\n")
    await Bun.write(path.join(dir, "payload.txt"), "a change to stage\n")
    await hook("probe-clean", "cat\nprintf filter-executed > .git/filter-fired")
    await hook("pre-commit", "printf commit-executed > .git/commit-fired")
    await hook("post-checkout", "printf checkout-executed > .git/checkout-fired")
    git("config", "filter.probe.clean", "sh .git/hooks/probe-clean")
    git("config", "filter.probe.required", "true")
    const before = { head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"), index: git("ls-files", "--stage") }
    const routes = [
      { path: "/git/add", body: { files: ["payload.txt"] } },
      { path: "/git/commit", body: { message: "unauthorized commit" } },
      { path: "/git/branch", body: { name: "unauthorized-branch", create: true } },
    ] as const
    const request = (role: "viewer" | "member" | "admin", route: { path: string; body: object }) =>
      server.fetch(`${route.path}?directory=${encodeURIComponent(dir)}`, {
        method: "POST",
        headers: { Authorization: token(role), "Content-Type": "application/json" },
        body: JSON.stringify(route.body),
      })

    for (const role of ["viewer", "member"] as const) {
      for (const route of routes) expect((await request(role, route)).status).toBe(403)
      expect(git("rev-parse", "HEAD")).toBe(before.head)
      expect(git("branch", "--show-current")).toBe(before.branch)
      expect(git("ls-files", "--stage")).toBe(before.index)
      for (const name of ["filter-fired", "commit-fired", "checkout-fired"]) expect(await marker(name)).toBe(false)
      expect(git("branch", "--list", "unauthorized-branch")).toBe("")
    }

    expect((await request("admin", routes[0])).status).toBe(200)
    expect(await marker("filter-fired")).toBe(true)
    expect((await request("admin", { path: "/git/commit", body: { message: "authorized commit" } })).status).toBe(200)
    expect(await marker("commit-fired")).toBe(true)
    expect((await request("admin", { path: "/git/branch", body: { name: "authorized-branch", create: true } })).status).toBe(200)
    expect(await marker("checkout-fired")).toBe(true)
    expect(git("branch", "--show-current")).toBe("authorized-branch")
  })

  test("admin bearer and operator Basic credentials retain TUI authority", async () => {
    await using project = await tmpdir({ git: true })
    expect((await command(project.path, token("admin"))).status).toBe(200)
    expect(
      (await command(project.path, `Basic ${Buffer.from(`unifia:${PASSWORD}`).toString("base64")}`)).status,
    ).toBe(200)
  })

  test("route registry matches dynamic paths and refuses future unclassified mutations", async () => {
    expect(classify("POST", "/tui/execute-command")).toBe("execute")
    expect(classify("GET", "/pty/pty_123/tail")).toBe("execute")
    expect(classify("POST", "/session/ses_123/shell")).toBe("execute")
    for (const route of ["/git/add", "/git/commit", "/git/branch", "/git/push", "/git/pull"]) {
      expect(classify("POST", route)).toBe("execute")
      expect(permitted("execute", "member")).toBe(false)
    }
    expect(classify("POST", "/git/reset")).toBe("write-content")
    expect(classify("HEAD", "/global/config")).toBe("read-metadata")
    expect(classify("POST", "/workbench/native/token")).toBe("public")
    expect(classify("POST", "/workbench/leases/issue")).toBe("public")
    expect(classify("POST", "/tui/execute-command/")).toBeUndefined()
    expect(permitted("write-content", "member")).toBe(true)
    expect(permitted("execute", "member")).toBe(false)
    expect(permitted("admin", "admin")).toBe(true)
    expect(
      (await server.fetch("/unregistered-remote-command", { method: "POST", headers: { Authorization: token("admin") } })).status,
    ).toBe(403)
  })

  test("the same role policy applies to a network peer without triggering a handler", async () => {
    const app = Server.ControlPlaneRoutes()
    const env = { hostname: "0.0.0.0", requestIP: () => ({ address: "203.0.113.10" }) }
    const blocked = await app.fetch(
      new Request("http://127.0.0.1/tui/execute-command", {
        method: "POST",
        headers: { Authorization: token("viewer"), "Content-Type": "application/json" },
        body: JSON.stringify({ command: "agent_cycle" }),
      }),
      env as never,
    )
    expect(blocked.status).toBe(403)
    expect(
      (await app.fetch(new Request("http://127.0.0.1/global/config", { headers: { Authorization: token("viewer") } }), env as never)).status,
    ).toBe(200)
    expect(
      (await app.fetch(new Request("http://127.0.0.1/global/health", { headers: { Authorization: token("admin") } }), env as never)).status,
    ).toBe(200)
  })

  test("the passwordless CLI stays on loopback, while network listeners require a password", async () => {
    const previous = Flag.UNIFIA_SERVER_PASSWORD
    try {
      // @ts-expect-error exercise the local CLI mode
      Flag.UNIFIA_SERVER_PASSWORD = undefined
      expect(() => Server.listen({ hostname: "0.0.0.0", port: 0 })).toThrow("UNIFIA_SERVER_PASSWORD")
      const local = await withInProcessServer()
      try {
        expect((await local.fetch("/global/health")).status).toBe(200)
        expect((await local.fetch("/unregistered-remote-command", { method: "POST" })).status).toBe(403)
      } finally {
        await local.close()
      }
    } finally {
      // @ts-expect-error restore test-only override
      Flag.UNIFIA_SERVER_PASSWORD = previous
    }
  })

  test("CORS preflight is handled before requiring a principal", async () => {
    const res = await Server.ControlPlaneRoutes().fetch(
      new Request("http://127.0.0.1:4096/tui/execute-command", {
        method: "OPTIONS",
        headers: { Origin: "http://127.0.0.1:4096", "Access-Control-Request-Method": "POST" },
      }),
      { hostname: "127.0.0.1", port: 4096, requestIP: () => ({ address: "127.0.0.1" }) } as never,
    )
    expect(res.status).toBe(204)
  })
})
