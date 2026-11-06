/* SPDX-License-Identifier: MIT */
import { afterEach, expect, test } from "bun:test"
import path from "node:path"
import { ToolchainRoutes } from "../../src/server/routes/toolchain"
import { ToolchainManager } from "../../src/toolchain/manager"
import { fixtureDirSync, removeFixtureSync } from "../fixture/run"
import { FIXTURE_KEY, FIXTURE_REPO, repository } from "../toolchain/repo-fixture"

const created: string[] = []
afterEach(() => created.splice(0).forEach(removeFixtureSync))

function app() {
  const base = fixtureDirSync("unifia-toolchain-route-")
  created.push(base)
  const served = repository([
    { name: "musl", version: "1.2.5-r9", files: { "lib/ld-musl-aarch64.so.1": "musl" } },
    { name: "lua5.4", version: "5.4.7-r0", depends: ["musl"], files: { "usr/bin/lua5.4": "lua" } },
  ])
  const manager = new ToolchainManager({
    root: path.join(base, "rootfs"),
    state: path.join(base, "state"),
    arch: "aarch64",
    repositories: [FIXTURE_REPO],
    keys: [FIXTURE_KEY],
    quotaBytes: 1_000_000,
    fetchBytes: async (url) => served.get(url) ?? Promise.reject(new Error(`404 ${url}`)),
  })
  return ToolchainRoutes(() => manager)
}

const post = (body?: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })

test("install, list and remove go through the real manager", async () => {
  const routes = app()
  const installed = await routes.request("/install", post({ packages: ["lua5.4"] }))
  expect(await installed.json()).toEqual({ installed: ["musl@1.2.5-r9", "lua5.4@5.4.7-r0"], removed: [] })
  const list = (await (await routes.request("/")).json()) as { name: string; explicit: boolean }[]
  expect(list.map((item) => [item.name, item.explicit])).toEqual([["musl", false], ["lua5.4", true]])
  const removed = await routes.request("/remove", post({ packages: ["lua5.4"] }))
  expect(((await removed.json()) as { removed: string[] }).removed.sort()).toEqual(["lua5.4", "musl"])
})

test("package names that are not Alpine names are refused before the manager runs", async () => {
  const routes = app()
  for (const packages of [[], ["../etc"], ["Lua"], ["lua; rm -rf /"]]) {
    expect((await routes.request("/install", post({ packages }))).status).toBe(400)
  }
})
