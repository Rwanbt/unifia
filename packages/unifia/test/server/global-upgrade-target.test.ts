/* SPDX-License-Identifier: MIT */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { withInProcessServer, type InProcessServer } from "../lib/in-process-server"
import { Installation } from "../../src/installation"
import { Flag } from "../../src/flag/flag"

const PASSWORD = "owner-password-upgrade-target-test"

let server: InProcessServer
let savedPassword: string | undefined

beforeAll(async () => {
  savedPassword = Flag.UNIFIA_SERVER_PASSWORD
  // @ts-expect-error test-only override, restored in afterAll
  Flag.UNIFIA_SERVER_PASSWORD = PASSWORD
  server = await withInProcessServer({ password: PASSWORD })
})

afterAll(async () => {
  await server.close()
  // @ts-expect-error restoring the value captured in beforeAll
  Flag.UNIFIA_SERVER_PASSWORD = savedPassword
})

function basic(): string {
  return "Basic " + Buffer.from(`unifia:${PASSWORD}`, "utf8").toString("base64")
}

function upgrade(body: unknown): Promise<Response> {
  return server.fetch("/global/upgrade", {
    method: "POST",
    headers: { Authorization: basic(), "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("the upgrade target is a plain release version", () => {
  test("a target that is not a semver is refused with 400, and nothing is installed", async () => {
    const method = spyOn(Installation, "method").mockResolvedValue("npm")
    const install = spyOn(Installation, "upgrade").mockResolvedValue()
    try {
      for (const target of [
        "latest; rm -rf ~",
        "1.2",
        "v1.2.3",
        "1.2.3 --global",
        "file:../unifia",
        "^1.2.3",
        "https://example.test/unifia.tgz",
      ]) {
        const response = await upgrade({ target })
        expect(response.status).toBe(400)
      }
      expect(install).not.toHaveBeenCalled()
    } finally {
      method.mockRestore()
      install.mockRestore()
    }
  })

  test("a plain semver target is installed as given", async () => {
    const method = spyOn(Installation, "method").mockResolvedValue("npm")
    const install = spyOn(Installation, "upgrade").mockResolvedValue()
    try {
      for (const target of ["1.2.3", "1.2.3-fork.2"]) {
        const response = await upgrade({ target })
        expect(response.status).toBe(200)
      }
      expect(install).toHaveBeenCalledTimes(2)
      expect(install.mock.calls[0]?.[1]).toBe("1.2.3")
      expect(install.mock.calls[1]?.[1]).toBe("1.2.3-fork.2")
    } finally {
      method.mockRestore()
      install.mockRestore()
    }
  })
})
