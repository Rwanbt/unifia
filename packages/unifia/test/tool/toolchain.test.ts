/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { MessageID, SessionID } from "../../src/session/schema"
import { ToolchainTool, toolchainToolAvailable } from "../../src/tool/toolchain"

function context(ask: () => Promise<void>) {
  return {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("message"),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask,
  }
}

test("the toolchain tool is offered only where the Android rootfs exists", () => {
  expect(toolchainToolAvailable({})).toBe(false)
  expect(toolchainToolAvailable({ OPENCODE_MOBILE_ROOTFS_DIR: "/data/user/0/ai.unifia/files/rootfs" })).toBe(true)
})

test("a change is refused when permission is denied, before any download", async () => {
  const tool = await ToolchainTool.init()
  const requests: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input))
    throw new Error("network must not be reached")
  }) as unknown as typeof fetch
  try {
    const denied = context(async () => {
      throw new Error("permission denied")
    })
    await expect(tool.execute({ action: "install", packages: ["python3"] }, denied)).rejects.toThrow("permission denied")
    expect(requests).toEqual([])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("install and remove need at least one package", async () => {
  const tool = await ToolchainTool.init()
  await expect(tool.execute({ action: "remove", packages: [] }, context(async () => {}))).rejects.toThrow(/at least one package/)
})
