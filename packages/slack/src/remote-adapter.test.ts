/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { KillSwitchRegistry } from "@unifia/contracts"
import { SlackRemoteAdapter } from "../src/remote-adapter.ts"
let now = 1_000
const audit: Array<{ type: string }> = []
const adapter = new SlackRemoteAdapter({ allowedChannels: ["C1"], allowedUsers: ["U1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 10 }, { verify: (_payload, signature) => signature === "bolt-verified" }, { record: (event) => audit.push(event) }, () => now)
assert.equal(adapter.authorize({ id: "M1", channelId: "C1", userId: "U1", text: "hello", timestamp: now }), true)
assert.equal(adapter.authorize({ id: "M1", channelId: "C1", userId: "U1", text: "hello", timestamp: now }), false)
assert.equal(adapter.authorize({ id: "M2", channelId: "C2", userId: "U1", text: "blocked", timestamp: now }), false)
assert.equal(audit.some((event) => event.type === "replay"), true)
const switches = new KillSwitchRegistry()
switches.engage("all-remote")
const disabled = new SlackRemoteAdapter({ allowedChannels: ["C1"], allowedUsers: ["U1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 10 }, { verify: () => true }, { record: () => {} }, () => now, undefined, switches)
assert.equal(disabled.authorize({ id: "M3", channelId: "C1", userId: "U1", text: "blocked", timestamp: now }), false)
console.log("SlackRemoteAdapter: 5/5 passed")
