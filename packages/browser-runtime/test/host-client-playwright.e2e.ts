/* SPDX-License-Identifier: MIT */
/**
 * #279 acceptance gate.
 *
 * This script MUST run under Bun, because Bun is the runtime that owns the
 * shipped Unifia server. Chromium still runs behind the Node Browser host
 * (ADR-089), so the test proves the exact production split instead of running
 * Playwright directly in Node like the lower-level driver e2e tests.
 */
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrowserHostClient } from "../src/host/host-client.ts"
import { startNodeHost } from "../src/host/node-host-transport.ts"

assert.ok(typeof Bun !== "undefined", "this acceptance gate must run under Bun")

const root = await mkdtemp(join(tmpdir(), "unifia-bun-node-browser-e2e-"))
const entry = join(import.meta.dir, "../src/host/host-entry.ts")
const target = "https://example.com/"

const client = new BrowserHostClient({
  start: (seed) =>
    startNodeHost(
      {
        entry,
        init: {
          policy: { allowedOrigins: ["*"], blockThirdPartyCookies: true, defaultDeny: true },
          quarantineRoot: join(root, "quarantine"),
        },
      },
      seed,
    ),
  seed: () => ({ sessions: [], storage: {} }),
  authorize: async (url) => new URL(url).origin === new URL(target).origin,
})

try {
  const session = await client.create({
    workspaceId: "bun-node-e2e",
    chatSessionId: "chat-bun-node-e2e",
    runtimeProfile: "isolated",
    viewport: { width: 800, height: 600 },
    capabilities: ["browser.navigate", "browser.observe", "browser.interact", "browser.control"],
  })

  const withTab = await client.openTab(session.id)
  const tabId = withTab.activeTabId
  assert.ok(tabId, "Browser host must create an active Chromium tab")

  // Production user navigation: the request originates in Bun, crosses stdio,
  // and is executed by Playwright in the Node host.
  await client.takeControl(session.id, "user")
  const navigated = await client.navigate(session.id, tabId, target, "user")
  assert.equal(new URL(navigated.tabs.find((tab) => tab.id === tabId)?.url ?? "").origin, "https://example.com")

  // Observation must cross the process boundary back into the Bun server.
  const observed = await client.observe(session.id, tabId)
  assert.equal(observed.receipt.origin, "https://example.com")
  assert.ok(observed.modelText.length > 100, "the live page accessibility snapshot must cross Node -> Bun")

  // AI takeover uses the same live Chromium page.
  const ai = await client.takeControl(session.id, "ai")
  assert.equal(ai.controller, "ai")
  const aiObservation = await client.observe(session.id, tabId)
  assert.equal(aiObservation.receipt.origin, "https://example.com")
  assert.ok(aiObservation.modelText.length > 100, "AI takeover must observe the same live page")

  // User takeover must cancel AI ownership and a real pointer input must reach
  // Chromium before the call resolves. Clicking the inert page corner avoids
  // introducing a second external navigation into this determinism gate.
  const user = await client.takeControl(session.id, "user")
  assert.equal(user.controller, "user")
  await client.input(session.id, tabId, { kind: "pointer", x: 8, y: 8, button: "left" })

  const screenshot = await client.screenshot(session.id, tabId)
  assert.ok(screenshot.byteLength > 100, "live Chromium screenshot must cross Node -> Bun")

  const kinds = client.activity(session.id).map((event) => event.kind)
  assert.ok(kinds.includes("page.observed"), "observation must be recorded")
  assert.ok(kinds.includes("controller.changed"), "takeover must be recorded")
  assert.ok(kinds.includes("user.input"), "the user pointer input must reach the live page")

  console.log("Bun -> Node Browser host -> Chromium E2E: launch, navigate, observe, takeover and pointer input passed")
} finally {
  await client.shutdown()
  await rm(root, { recursive: true, force: true })
}
