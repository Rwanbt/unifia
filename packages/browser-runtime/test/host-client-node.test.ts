/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrowserHostClient } from "../src/host/host-client.ts"
import { startNodeHost } from "../src/host/node-host-transport.ts"

/**
 * The runtime the server ships is Bun and the host is Node (ADR-089), so this
 * is the one place a Bun process talks to a real Node host over real pipes.
 * Chromium is never launched: `session.create` and `session.close` do not
 * open a page. Pages are covered by the Node-run e2e of the driver.
 */
const nodeAvailable = spawnSync(process.env.UNIFIA_NODE_PATH ?? "node", ["--version"]).status === 0
const entry = join(import.meta.dir, "../src/host/host-entry.ts")

function client() {
  const quarantineRoot = mkdtempSync(join(tmpdir(), "unifia-host-node-"))
  const errors: Error[] = []
  const instance = new BrowserHostClient({
    start: (seed) =>
      startNodeHost({ entry, init: { policy: { allowedOrigins: ["*"], defaultDeny: true }, quarantineRoot } }, seed),
    seed: () => ({ sessions: [], storage: {} }),
    authorize: async () => true,
    onError: (error) => errors.push(error),
  })
  return { instance, errors }
}

const viewport = { width: 800, height: 600 }

test.skipIf(!nodeAvailable)("a Bun client creates and closes a session in a real Node host", async () => {
  const { instance, errors } = client()
  try {
    const session = await instance.create({ workspaceId: "w1", chatSessionId: "c1", runtimeProfile: "isolated", viewport, capabilities: ["browser.navigate"] })
    // Read synchronously, from the mirror the host's sync events keep current.
    expect(instance.get(session.id).status).toBe("ready")
    expect(instance.forChatSession("w1", "c1")).toEqual({ sessionId: session.id, capabilities: ["browser.navigate"] })
    expect(instance.activity(session.id).map((event) => event.kind)).toContain("session.created")

    await instance.close(session.id)
    expect(() => instance.get(session.id)).toThrow("browser session is unavailable")
  } finally {
    await instance.shutdown()
  }
  expect(errors).toEqual([])
}, 30_000)

test.skipIf(!nodeAvailable)("a typed host error crosses the process boundary with its name", async () => {
  const { instance } = client()
  try {
    const error = await instance.openTab("no-such-session").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("unavailable")
  } finally {
    await instance.shutdown()
  }
}, 30_000)
