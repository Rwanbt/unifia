/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { InMemoryMemoryStore, MemoryRuntime } from "../src/index.ts"

const makeRuntime = (overrides: { promptInjectionEnabled?: boolean; maxRecordsPerWorkspace?: number; maxContentLength?: number } = {}) =>
  new MemoryRuntime(new InMemoryMemoryStore(), {
    promptInjectionEnabled: overrides.promptInjectionEnabled ?? false,
    maxRecordsPerWorkspace: overrides.maxRecordsPerWorkspace ?? 2,
    maxContentLength: overrides.maxContentLength ?? 100,
  }, () => 1_000)

describe("MemoryRuntime policy and isolation", () => {
  test("default policy never injects saved memories into a prompt", async () => {
    const memory = makeRuntime()
    await memory.remember({ workspaceId: "ws", content: "architecture decision", source: "user", id: "m1" })
    expect(await memory.promptContext({ workspaceId: "ws" })).toBe("")
  })

  test("search respects workspace, tags and content filters", async () => {
    const memory = makeRuntime()
    await memory.remember({ workspaceId: "ws", content: "architecture decision", source: "user", tags: ["architecture"], id: "m1" })
    await memory.remember({ workspaceId: "other", content: "architecture decision", source: "agent", tags: ["architecture"], id: "m2" })
    expect((await memory.search({ workspaceId: "ws", text: "DECISION" })).map((r) => r.id)).toEqual(["m1"])
    expect((await memory.search({ workspaceId: "ws", tags: ["other"] })).length).toBe(0)
    expect((await memory.search({ workspaceId: "other" })).map((r) => r.id)).toEqual(["m2"])
  })

  test("deletion hides the record without deleting another workspace record", async () => {
    const memory = makeRuntime()
    await memory.remember({ workspaceId: "ws", content: "decision", source: "user", id: "m1" })
    await memory.remember({ workspaceId: "other", content: "other decision", source: "user", id: "m1" })
    expect(await memory.remove("ws", "m1")).toBe(true)
    expect(await memory.search({ workspaceId: "ws" })).toEqual([])
    expect((await memory.search({ workspaceId: "other" })).length).toBe(1)
    expect(await memory.remove("ws", "m1")).toBe(true)
    expect(await memory.remove("ws", "missing")).toBe(false)
  })

  test("policy refuses excessive length and excessive records", async () => {
    const memory = makeRuntime({ maxRecordsPerWorkspace: 1, maxContentLength: 4 })
    await expect(memory.remember({ workspaceId: "ws", content: "12345", source: "user" })).rejects.toThrow("memory content exceeds policy")
    await memory.remember({ workspaceId: "ws", content: "1234", source: "user" })
    await expect(memory.remember({ workspaceId: "ws", content: "2", source: "user" })).rejects.toThrow("memory quota exceeded")
  })

  test("explicitly enabled prompt context only includes the requested workspace", async () => {
    const memory = makeRuntime({ promptInjectionEnabled: true })
    await memory.remember({ workspaceId: "ws", content: "only this", source: "user", id: "m1" })
    await memory.remember({ workspaceId: "other", content: "never this", source: "user", id: "m2" })
    expect(await memory.promptContext({ workspaceId: "ws" })).toBe("[memory:m1] only this")
  })
})
