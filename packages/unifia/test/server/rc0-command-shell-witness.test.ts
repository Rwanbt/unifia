// SPDX-License-Identifier: MIT
import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

async function command(app: ReturnType<typeof Server.Default>, sessionID: string, target: string) {
  return app.request(`/session/${sessionID}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "init",
      model: "rc0-missing/model",
      arguments: `!\`printf rc0-harmless > '${target}'\``,
    }),
  })
}

test("session.command JSON cannot run an argument directive denied by the session", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({
        permission: [{ permission: "bash", pattern: "*", action: "deny" }],
      })
      const target = path.join(tmp.path, "http-denied.txt")
      const response = await command(Server.Default(), session.id, target)
      expect(existsSync(target)).toBe(false)
      expect(response.status).toBe(403)
      const body = (await response.json()) as { name: string; data: { message: string } }
      expect(body.name).toBe("PermissionDeniedError")
      expect(body.data.message).toContain("prevents you from using this specific tool call")
      expect(JSON.stringify(body)).not.toContain("\n    at ")
    },
  })
})

test("session.command JSON runs the directive after the session allows it", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({
        permission: [{ permission: "bash", pattern: "*", action: "allow" }],
      })
      const target = path.join(tmp.path, "http-allowed.txt")
      const response = await command(Server.Default(), session.id, target)
      expect(existsSync(target), `${response.status} ${await response.text()}`).toBe(true)
    },
  })
})
