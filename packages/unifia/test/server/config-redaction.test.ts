/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { Flag } from "../../src/flag/flag"
import { JwtAuth } from "../../src/server/auth-jwt"
import { User } from "../../src/user"

// The placeholder every secret reads as. A write that sends it back keeps the stored value.
const PLACEHOLDER = "[redacted]"

const PASSWORD = "owner-password-redaction-test"
const JWT_SECRET = "jwt-signing-secret-redaction-test"
const PROVIDER_KEY = "sk-provider-key-redaction-test"
const CLIENT_SECRET = "oauth-client-secret-redaction-test"
const HEADER_VALUE = "header-token-redaction-test"

// Every file the global configuration may be stored in: the one the write uses is whichever exists, or the first.
const GLOBAL_FILES = ["unifia.jsonc", "unifia.json", "config.json", "opencode.json", "opencode.jsonc"].map((file) =>
  path.join(Global.Path.config, file),
)

let server: InProcessServer
let savedPassword: string | undefined
let savedGlobal: Map<string, string | undefined>

beforeAll(async () => {
  savedPassword = Flag.UNIFIA_SERVER_PASSWORD
  savedGlobal = new Map(
    GLOBAL_FILES.map((file) => [file, existsSync(file) ? readFileSync(file, "utf8") : undefined] as const),
  )
  // @ts-expect-error test-only override, restored in afterAll
  Flag.UNIFIA_SERVER_PASSWORD = PASSWORD
  server = await withInProcessServer({ password: PASSWORD })
  await Config.updateGlobal({
    experimental: {
      collaborative: { enabled: false, require_auth: true, allow_registration: false, jwt_secret: JWT_SECRET },
    },
    provider: { anthropic: { options: { apiKey: PROVIDER_KEY } } },
    mcp: {
      remote: {
        type: "remote",
        url: "https://mcp.example.test/sse",
        headers: { Authorization: HEADER_VALUE },
        oauth: { clientSecret: CLIENT_SECRET },
      },
    },
  })
})

afterAll(async () => {
  await server.close()
  for (const [file, content] of savedGlobal) {
    if (content === undefined) rmSync(file, { force: true })
    else writeFileSync(file, content)
  }
  // @ts-expect-error restoring the value captured in beforeAll
  Flag.UNIFIA_SERVER_PASSWORD = savedPassword
})

function basic(): string {
  return "Basic " + Buffer.from(`unifia:${PASSWORD}`, "utf8").toString("base64")
}

async function accountToken(role: "viewer" | "member"): Promise<string> {
  const user = await User.register({ username: `redact-${role}-${Date.now()}`, password: "correct horse battery", role })
  return JwtAuth.issue(user).accessToken
}

function call(method: string, route: string, authorization: string, body?: unknown): Promise<Response> {
  return server.fetch(route, {
    method,
    headers: {
      Authorization: authorization,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function expectRedacted(text: string) {
  for (const secret of [JWT_SECRET, PROVIDER_KEY, CLIENT_SECRET, HEADER_VALUE]) {
    expect(text).not.toContain(secret)
  }
}

describe("configuration reads redact every secret, for every caller", () => {
  test("the owner reads the global configuration with the placeholder in place of each secret", async () => {
    const response = await call("GET", "/global/config", basic())
    expect(response.status).toBe(200)
    const text = await response.text()
    expectRedacted(text)
    const body = JSON.parse(text)
    expect(body.experimental.collaborative.jwt_secret).toBe(PLACEHOLDER)
    expect(body.provider.anthropic.options.apiKey).toBe(PLACEHOLDER)
    expect(body.mcp.remote.oauth.clientSecret).toBe(PLACEHOLDER)
    expect(body.mcp.remote.headers.Authorization).toBe(PLACEHOLDER)
  })

  test("a viewer reads the global configuration with the same placeholders", async () => {
    const response = await call("GET", "/global/config", `Bearer ${await accountToken("viewer")}`)
    expect(response.status).toBe(200)
    const text = await response.text()
    expectRedacted(text)
    expect(JSON.parse(text).provider.anthropic.options.apiKey).toBe(PLACEHOLDER)
  })

  test("the project configuration read redacts the same secrets", async () => {
    await using project = await tmpdir({ git: true })
    const response = await call("GET", `/config?directory=${encodeURIComponent(project.path)}`, basic())
    expect(response.status).toBe(200)
    const text = await response.text()
    expectRedacted(text)
    expect(JSON.parse(text).experimental.collaborative.jwt_secret).toBe(PLACEHOLDER)
  })
})

describe("configuration writes keep a redacted field unchanged", () => {
  test("a global write that sends the placeholder back does not change the stored secret", async () => {
    const read = await call("GET", "/global/config", basic())
    const patched = await call("PATCH", "/global/config", basic(), await read.json())
    expect(patched.status).toBe(200)
    expectRedacted(await patched.text())
    const stored = await Config.getGlobal()
    expect(stored.provider?.anthropic?.options?.apiKey).toBe(PROVIDER_KEY)
    expect(stored.experimental?.collaborative?.jwt_secret).toBe(JWT_SECRET)
    expect(stored.mcp?.remote).toMatchObject({ headers: { Authorization: HEADER_VALUE } })
    for (const file of GLOBAL_FILES) {
      if (existsSync(file)) expect(readFileSync(file, "utf8")).not.toContain(PLACEHOLDER)
    }
  })

  test("a project write that sends the placeholder back writes no placeholder into the project file", async () => {
    await using project = await tmpdir({ git: true })
    const directory = encodeURIComponent(project.path)
    const read = await call("GET", `/config?directory=${directory}`, basic())
    const patched = await call("PATCH", `/config?directory=${directory}`, basic(), await read.json())
    expect(patched.status).toBe(200)
    expectRedacted(await patched.text())
    const projectFile = path.join(project.path, "config.json")
    if (existsSync(projectFile)) expect(readFileSync(projectFile, "utf8")).not.toContain(PLACEHOLDER)
    const stored = await Config.getGlobal()
    expect(stored.provider?.anthropic?.options?.apiKey).toBe(PROVIDER_KEY)
  })

  test("a global write of a new value replaces the stored secret", async () => {
    const patched = await call("PATCH", "/global/config", basic(), {
      provider: { anthropic: { options: { apiKey: "sk-provider-key-rotated" } } },
    })
    expect(patched.status).toBe(200)
    expectRedacted(await patched.text())
    const stored = await Config.getGlobal()
    expect(stored.provider?.anthropic?.options?.apiKey).toBe("sk-provider-key-rotated")
    // Put the original value back for the tests that follow.
    await Config.updateGlobal({ provider: { anthropic: { options: { apiKey: PROVIDER_KEY } } } })
  })
})
