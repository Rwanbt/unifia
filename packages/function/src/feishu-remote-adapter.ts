/* SPDX-License-Identifier: MIT */
import { RemoteBridgeBroker, type RemoteBridgePolicy, type RemoteMessage, type RemoteCommand, type RemoteCommandResult } from "@unifia/contracts"

export type FeishuIngress = { id: string; channelId: string; userId: string; text: string; timestamp: number; callbackTimestamp: string; nonce: string; signature: string; rawBody: string }

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => left.length === right.length && left.every((value, index) => value === right[index])
const hex = (bytes: Uint8Array): string => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")

export const verifyFeishuCallbackSignature = async (input: { timestamp: string; nonce: string; encryptKey: string; rawBody: string; signature: string }): Promise<boolean> => {
  const data = new TextEncoder().encode(`${input.timestamp}${input.nonce}${input.encryptKey}${input.rawBody}`)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
  const expected = input.signature.trim().toLowerCase()
  const actual = hex(digest)
  return equalBytes(new TextEncoder().encode(actual), new TextEncoder().encode(expected))
}

export class FeishuRemoteAdapter {
  readonly #broker: RemoteBridgeBroker
  readonly #paired = new Set<string>()
  readonly #encryptKey: string
  constructor(policy: RemoteBridgePolicy, encryptKey: string, audit: { record(event: { type: string; identityId: string; reason?: string }): void }, now: () => number = () => Date.now()) {
    this.#encryptKey = encryptKey
    this.#broker = new RemoteBridgeBroker({ policy, verifier: { verify: () => true }, audit, now })
  }
  async authorize(input: FeishuIngress): Promise<boolean> {
    if (!await verifyFeishuCallbackSignature({ timestamp: input.callbackTimestamp, nonce: input.nonce, encryptKey: this.#encryptKey, rawBody: input.rawBody, signature: input.signature })) return false
    const identityId = `feishu:${input.userId}`
    if (!this.#paired.has(identityId)) {
      this.#broker.pair({ id: identityId, providerId: "feishu", userId: input.userId, scopes: ["read"], expiresAt: Date.now() + 30 * 60_000 })
      this.#paired.add(identityId)
    }
    const message: RemoteMessage = { id: input.id, channelId: input.channelId, userId: input.userId, text: input.text, timestamp: input.timestamp }
    return this.#broker.authorizeMessage({ identityId, message, signature: "verified", nonce: input.nonce })
  }
  authorizeCommand(userId: string, command: RemoteCommand): RemoteCommandResult { return this.#broker.authorizeCommand(`feishu:${userId}`, command) }
}
