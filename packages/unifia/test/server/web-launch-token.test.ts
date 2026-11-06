/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { Flag } from "../../src/flag/flag"
import { heldCredentials, holdCredentials } from "../../src/flag/held-credentials"
import { isEmbeddedInterfaceRequest } from "../../src/server/server"
import { ensureWebLaunchToken, webLaunchUrl } from "../../src/server/web-launch-token"

const original = heldCredentials()
const holdPassword = (password: string | undefined) => holdCredentials({ ...heldCredentials(), password })
afterEach(() => {
  holdCredentials(original)
})

describe("web launch token", () => {
  test("NoPassword_GeneratesOneAndPutsItInTheFragment", () => {
    holdPassword(undefined)
    const token = ensureWebLaunchToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(Flag.UNIFIA_SERVER_PASSWORD).toBe(token as string)
    expect(webLaunchUrl("http://localhost:4096/", token)).toBe(`http://localhost:4096/#token=${token}`)
  })

  test("ConfiguredPassword_IsKeptAndNeverPutInTheUrl", () => {
    holdPassword("chosen")
    expect(ensureWebLaunchToken()).toBeUndefined()
    expect(Flag.UNIFIA_SERVER_PASSWORD).toBe("chosen")
    expect(webLaunchUrl("http://localhost:4096/", undefined)).toBe("http://localhost:4096/")
  })
})

describe("isEmbeddedInterfaceRequest", () => {
  const probe = async (method: string, path: string, headers: Record<string, string> = {}) => {
    const app = new Hono().all("*", (c) => c.body(null, 200, { "x-embedded": String(isEmbeddedInterfaceRequest(c)) }))
    return (await app.request(path, { method, headers })).headers.get("x-embedded")
  }

  test("StaticInterfacePaths_LoadWithoutCredentials", async () => {
    expect(await probe("GET", "/")).toBe("true")
    expect(await probe("GET", "/assets/index-abc.js")).toBe("true")
    expect(await probe("HEAD", "/favicon.ico")).toBe("true")
  })

  test("ApiRoutesUpgradesAndMutations_StillNeedThem", async () => {
    expect(await probe("GET", "/global/health")).toBe("false")
    expect(await probe("GET", "/global/config")).toBe("false")
    expect(await probe("POST", "/assets/index-abc.js")).toBe("false")
    expect(await probe("GET", "/", { upgrade: "websocket" })).toBe("false")
  })
})
