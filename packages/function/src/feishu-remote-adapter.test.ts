/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { KillSwitchRegistry } from "@unifia/contracts"
import { FeishuRemoteAdapter, verifyFeishuCallbackSignature } from "../src/feishu-remote-adapter"
const timestamp = "1"
const nonce = "n-1"
const encryptKey = "key"
const rawBody = "{\"event_id\":\"e-1\"}"
const signature = createHash("sha256").update(`${timestamp}${nonce}${encryptKey}${rawBody}`).digest("hex")
assert.equal(await verifyFeishuCallbackSignature({ timestamp, nonce, encryptKey, rawBody, signature }), true)
assert.equal(await verifyFeishuCallbackSignature({ timestamp, nonce, encryptKey, rawBody: "tampered", signature }), false)

// No Encrypt Key configured means no callback is trusted: the worker route
// relays into Discord, so an unverifiable callback must fail closed.
assert.equal(await verifyFeishuCallbackSignature({ timestamp, nonce, encryptKey: "", rawBody, signature }), false)

// The signature never expires by itself; the skew window is what stops a replay.
const fresh = String(Math.floor(Date.now() / 1000))
const freshSignature = createHash("sha256").update(`${fresh}${nonce}${encryptKey}${rawBody}`).digest("hex")
assert.equal(await verifyFeishuCallbackSignature({ timestamp: fresh, nonce, encryptKey, rawBody, signature: freshSignature, now: Date.now() }), true)
assert.equal(await verifyFeishuCallbackSignature({ timestamp: fresh, nonce, encryptKey, rawBody, signature: freshSignature, now: Date.now() + 3_600_000 }), false)
assert.equal(await verifyFeishuCallbackSignature({ timestamp: "not-a-number", nonce, encryptKey, rawBody, signature, now: Date.now() }), false)
let now = 1_000
const adapter = new FeishuRemoteAdapter({ allowedChannels: ["chat-1"], allowedUsers: ["user-1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 10 }, encryptKey, { record: () => {} }, () => now)
const ingress = { id: "e-1", channelId: "chat-1", userId: "user-1", text: "hello", timestamp: now, callbackTimestamp: timestamp, nonce, signature, rawBody }
assert.equal(await adapter.authorize(ingress), true)
assert.equal(await adapter.authorize(ingress), false)
const switches = new KillSwitchRegistry()
switches.engage("all-remote")
const disabled = new FeishuRemoteAdapter({ allowedChannels: ["chat-1"], allowedUsers: ["user-1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 10 }, encryptKey, { record: () => {} }, () => now, switches)
assert.equal(await disabled.authorize(ingress), false)
console.log("FeishuRemoteAdapter: 11/11 passed")
