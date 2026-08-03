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
let now = 1_000
const adapter = new FeishuRemoteAdapter({ allowedChannels: ["chat-1"], allowedUsers: ["user-1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 10 }, encryptKey, { record: () => {} }, () => now)
const ingress = { id: "e-1", channelId: "chat-1", userId: "user-1", text: "hello", timestamp: now, callbackTimestamp: timestamp, nonce, signature, rawBody }
assert.equal(await adapter.authorize(ingress), true)
assert.equal(await adapter.authorize(ingress), false)
const switches = new KillSwitchRegistry()
switches.engage("all-remote")
const disabled = new FeishuRemoteAdapter({ allowedChannels: ["chat-1"], allowedUsers: ["user-1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 10 }, encryptKey, { record: () => {} }, () => now, switches)
assert.equal(await disabled.authorize(ingress), false)
console.log("FeishuRemoteAdapter: 5/5 passed")
