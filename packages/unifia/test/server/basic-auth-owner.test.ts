/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { tmpdir } from "../fixture/fixture"
import { resetMemoryCache } from "../../src/knowledge/app/memory"
import { Flag } from "../../src/flag/flag"

// A password with a colon: the owner's Basic credentials must still identify the owner.
const PASSWORD = "owner:secret:with-colons"

let savedPassword: string | undefined
let server: InProcessServer

beforeAll(async () => {
  savedPassword = Flag.UNIFIA_SERVER_PASSWORD
  // @ts-expect-error test-only override, restored in afterAll
  Flag.UNIFIA_SERVER_PASSWORD = PASSWORD
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
  resetMemoryCache()
  // @ts-expect-error restoring the value captured in beforeAll
  Flag.UNIFIA_SERVER_PASSWORD = savedPassword
})

function basic(password: string): string {
  return "Basic " + Buffer.from(`unifia:${password}`, "utf8").toString("base64")
}

function status(project: string, authorization: string | undefined): Promise<Response> {
  return server.fetch(`/knowledge/status?directory=${encodeURIComponent(project)}`, {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  })
}

describe("the owner's Basic credentials, over the knowledge routes", () => {
  test("the operator's password, which contains colons, identifies the owner", async () => {
    await using project = await tmpdir({ git: true })
    const response = await status(project.path, basic(PASSWORD))
    expect(response.status).toBe(200)
  })

  test("a wrong password is refused before the vault is read", async () => {
    await using project = await tmpdir({ git: true })
    const response = await status(project.path, basic(PASSWORD.slice(0, -1)))
    expect(response.status).toBe(401)
  })

  test("a request with no credentials is refused for the owner's routes", async () => {
    await using project = await tmpdir({ git: true })
    const response = await status(project.path, undefined)
    expect(response.status).toBe(401)
  })
})
