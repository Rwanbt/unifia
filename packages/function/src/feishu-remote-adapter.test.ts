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

// A sender outside the allowlist is refused without its traffic pairing it.
const policy = { allowedChannels: ["chat-1"], allowedUsers: ["user-1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 10, readOnlyCommands: ["status"] }
const pairEvents: string[] = []
const solo = new FeishuRemoteAdapter(policy, encryptKey, { record: (event) => { if (event.type === "pair") pairEvents.push(event.identityId) } }, () => now)
const attackerSignature = createHash("sha256").update(`${timestamp}${nonce}${encryptKey}${rawBody}`).digest("hex")
assert.equal(await solo.authorize({ ...ingress, id: "e-9", userId: "attacker", signature: attackerSignature }), false)
assert.equal(pairEvents.includes("feishu:attacker"), false)

// The nonce is inside the signed string, so each one carries its own signature.
const signedWith = (n: string) => ({ ...ingress, nonce: n, signature: createHash("sha256").update(`${timestamp}${n}${encryptKey}${rawBody}`).digest("hex") })

// Feishu disables on its own, and revocation is local and immediate.
solo.setEnabled(false)
assert.equal(await solo.authorize({ ...signedWith("n-2"), id: "e-2" }), false)
solo.setEnabled(true)
assert.equal(await solo.authorize({ ...signedWith("n-2"), id: "e-2" }), true)

// A command declaring nothing does not reach the runtime.
assert.equal(solo.authorizeCommand("user-1", { id: "c-1", text: "rm -rf /", scope: "global" }).result, "capability-required")

// Revocation then closes both paths for that identity.
assert.equal(solo.revoke("user-1"), true)
assert.equal(await solo.authorize({ ...signedWith("n-3"), id: "e-3" }), false)
assert.equal(solo.authorizeCommand("user-1", { id: "c-2", text: "status", scope: "session", metadata: { mode: "read-only", command: "status" } }).result, "identity-invalid")

console.log("FeishuRemoteAdapter: 20/20 passed")
