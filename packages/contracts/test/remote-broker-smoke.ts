/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { ApprovalBroker } from "../src/approval-broker.ts"
import { RemoteBridgeBroker } from "../src/remote.ts"
let now = 1_000
const audit: Array<{ type: string; reason?: string }> = []
const broker = new RemoteBridgeBroker({ policy: { allowedChannels: ["c-1"], allowedUsers: ["u-1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 2 }, verifier: { verify: (payload, signature) => payload.includes("m-1") && signature === "ok" }, audit: { record: (event) => audit.push(event) }, now: () => now })
const identity = broker.pair({ id: "i-1", providerId: "slack", userId: "u-1", scopes: ["read"], expiresAt: 10_000 })
const message = { id: "m-1", providerId: "slack" as const, channelId: "c-1", userId: "u-1", text: "hello", timestamp: now }
assert.equal(broker.authorizeMessage({ identityId: identity.id, message, signature: "ok", nonce: "n-1" }), true)
assert.equal(broker.authorizeMessage({ identityId: identity.id, message, signature: "ok", nonce: "n-1" }), false)
const pending = broker.authorizeCommand(identity.id, { id: "cmd-1", text: "write", scope: "workspace", metadata: { capability: "workspace.write" } })
assert.equal(pending.status, "denied")
const approvalBroker = new ApprovalBroker(() => now)
const guarded = new RemoteBridgeBroker({ policy: { allowedChannels: ["c-1"], allowedUsers: ["u-1"], maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000, maxMessagesPerMinute: 2 }, verifier: { verify: () => true }, audit: { record: () => {} }, now: () => now, approvals: approvalBroker })
guarded.pair({ id: "i-2", providerId: "slack", userId: "u-1", scopes: ["write"], expiresAt: 10_000 })
const approved = guarded.authorizeCommand("i-2", { id: "cmd-2", text: "write", scope: "workspace", metadata: { capability: "workspace.write" } })
assert.equal(approved.status, "pending-approval")
assert.equal(broker.revoke(identity.id), true)
assert.equal(audit.some((event) => event.type === "replay"), true)
console.log("RemoteBridgeBroker: 7/7 passed")
