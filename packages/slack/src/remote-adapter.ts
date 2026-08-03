/* SPDX-License-Identifier: MIT */
import { ApprovalBroker, KillSwitchRegistry, RemoteBridgeBroker, type RemoteCommand, type RemoteCommandResult, type RemoteMessage, type RemoteApprovalPort, type RemoteBridgePolicy, type RemoteVerifier } from "@unifia/contracts"

type SlackIngress = { id: string; channelId: string; userId: string; text: string; timestamp: number }

export class SlackRemoteAdapter {
  readonly #broker: RemoteBridgeBroker
  readonly #now: () => number
  readonly #paired = new Set<string>()
  readonly #switches: KillSwitchRegistry
  constructor(policy: RemoteBridgePolicy, verifier: RemoteVerifier, audit: { record(event: { type: "pair" | "revoke" | "message" | "replay" | "deny" | "approval"; identityId: string; reason?: string }): void }, now: () => number = () => Date.now(), approvals?: RemoteApprovalPort, switches: KillSwitchRegistry = new KillSwitchRegistry()) {
    this.#now = now
    this.#switches = switches
    this.#broker = new RemoteBridgeBroker({ policy, verifier, audit, now, approvals })
  }
  authorize(input: SlackIngress): boolean {
    if (this.#switches.isEngaged("all-remote")) return false
    const identityId = `slack:${input.userId}`
    if (!this.#paired.has(identityId) && !this.#brokerIdentity(identityId, input.userId)) return false
    const message: RemoteMessage = { id: input.id, channelId: input.channelId, userId: input.userId, text: input.text, timestamp: input.timestamp }
    return this.#broker.authorizeMessage({ identityId, message, signature: "bolt-verified", nonce: `${input.channelId}:${input.id}` })
  }
  authorizeCommand(userId: string, command: RemoteCommand): RemoteCommandResult {
    if (this.#switches.isEngaged("all-remote")) return { commandId: command.id, status: "denied", result: "remote-disabled" }
    return this.#broker.authorizeCommand(`slack:${userId}`, command)
  }
  resolveApproval(id: string, decision: "allow" | "deny"): unknown { return this.#broker.resolveApproval(id, decision, "slack-host") }
  #brokerIdentity(identityId: string, userId: string): boolean {
    try {
      this.#broker.pair({ id: identityId, providerId: "slack", userId, scopes: ["read"], expiresAt: this.#now() + 30 * 60_000 })
      this.#paired.add(identityId)
      return true
    } catch { return false }
  }
}

export const createSlackRemoteAdapter = (audit: { record(event: { type: "pair" | "revoke" | "message" | "replay" | "deny" | "approval"; identityId: string; reason?: string }): void }, now: () => number = () => Date.now()): SlackRemoteAdapter => {
  const list = (name: string): string[] => (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  const policy: RemoteBridgePolicy = { allowedChannels: list("UNIFIA_SLACK_ALLOWED_CHANNELS"), allowedUsers: list("UNIFIA_SLACK_ALLOWED_USERS"), maxMessageAgeMs: 30_000, maxAttachmentBytes: 1_000_000, maxMessagesPerMinute: 30 }
  return new SlackRemoteAdapter(policy, { verify: (_payload, signature) => signature === "bolt-verified" }, audit, now, new ApprovalBroker(now))
}
