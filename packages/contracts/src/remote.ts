/**
 * RemoteTransportPort — abstraction sur les transports distants (Slack, Feishu)
 *
 * Source : Plan V3 §7.6
 */
export type RemoteProviderId = "slack" | "feishu" | "discord"
export type RemoteChannelId = string

export interface RemoteMessage {
  id: string
  channelId: RemoteChannelId
  userId: string
  text: string
  timestamp: number
  attachments?: unknown[]
}

export interface RemoteCommand {
  id: string
  text: string
  scope: "workspace" | "session" | "global"
  metadata?: Record<string, string>
}

export interface RemoteCommandResult {
  commandId: string
  status: "accepted" | "denied" | "pending-approval"
  result?: unknown
}

export interface RemoteIdentity {
  id: string
  providerId: RemoteProviderId
  userId: string
  scopes: string[]
  pairedAt: number
  expiresAt?: number
}

export interface RemoteSubscription {
  channels: RemoteChannelId[]
  eventTypes: string[]
}

export interface RemoteEvent {
  type: "message" | "command" | "pair-request" | "unpair"
  providerId: RemoteProviderId
  data: unknown
  timestamp: number
}

export interface RemoteTransportPort {
  send(channelId: RemoteChannelId, message: RemoteMessage): Promise<void>
  receive(subscription: RemoteSubscription): AsyncIterable<RemoteEvent>
  execute(command: RemoteCommand): Promise<RemoteCommandResult>
  pair(identity: Omit<RemoteIdentity, "pairedAt">): Promise<RemoteIdentity>
  unpair(identityId: string): Promise<void>
}

export type RemoteAudit = { record(event: { type: "pair" | "revoke" | "message" | "replay" | "deny" | "approval"; identityId: string; reason?: string }): void }
export type RemoteVerifier = { verify(payload: string, signature: string): boolean }
export type RemoteApprovalPort = { request(capability: string, resource: string, expiresAt: number): { id: string }; find(capability: string, resource: string): { status: string; id: string } | undefined; resolve?: (id: string, decision: "allow" | "deny", actor: string, grantedResource?: string) => unknown }
export type RemoteBridgePolicy = {
  allowedChannels: readonly string[]
  allowedUsers: readonly string[]
  maxMessageAgeMs: number
  maxAttachmentBytes: number
  maxMessagesPerMinute: number
}

export class RemoteBridgeBroker {
  readonly #identities = new Map<string, RemoteIdentity>()
  readonly #nonces = new Map<string, Map<string, number>>()
  readonly #messageTimes = new Map<string, number[]>()
  readonly #policy: RemoteBridgePolicy
  readonly #verifier: RemoteVerifier
  readonly #audit: RemoteAudit
  readonly #now: () => number
  readonly #approvals?: RemoteApprovalPort
  constructor(input: { policy: RemoteBridgePolicy; verifier: RemoteVerifier; audit: RemoteAudit; now?: () => number; approvals?: RemoteApprovalPort }) {
    this.#policy = input.policy
    this.#verifier = input.verifier
    this.#audit = input.audit
    this.#now = input.now ?? (() => Date.now())
    this.#approvals = input.approvals
  }
  pair(identity: Omit<RemoteIdentity, "pairedAt">): RemoteIdentity {
    const now = this.#now()
    if (identity.expiresAt !== undefined && identity.expiresAt <= now) throw new Error("remote identity is expired")
    const paired = { ...identity, pairedAt: now, scopes: [...identity.scopes] }
    this.#identities.set(paired.id, paired)
    this.#nonces.set(paired.id, new Map())
    this.#messageTimes.set(paired.id, [])
    this.#audit.record({ type: "pair", identityId: paired.id })
    return { ...paired, scopes: [...paired.scopes] }
  }
  revoke(identityId: string): boolean {
    const removed = this.#identities.delete(identityId)
    this.#nonces.delete(identityId)
    this.#messageTimes.delete(identityId)
    if (removed) this.#audit.record({ type: "revoke", identityId })
    return removed
  }
  authorizeMessage(input: { identityId: string; message: RemoteMessage; signature: string; nonce: string }): boolean {
    const identity = this.#validIdentity(input.identityId)
    if (!identity || !this.#policy.allowedUsers.includes(identity.userId) || identity.userId !== input.message.userId || !this.#policy.allowedChannels.includes(input.message.channelId)) return this.#deny(input.identityId, "identity-or-channel")
    const now = this.#now()
    if (Math.abs(now - input.message.timestamp) > this.#policy.maxMessageAgeMs) return this.#deny(input.identityId, "timestamp")
    if (JSON.stringify(input.message.attachments ?? []).length > this.#policy.maxAttachmentBytes) return this.#deny(input.identityId, "attachment-quota")
    const nonces = this.#nonces.get(input.identityId)!
    for (const [value, timestamp] of nonces) if (now - timestamp > this.#policy.maxMessageAgeMs) nonces.delete(value)
    if (nonces.has(input.nonce)) return this.#deny(input.identityId, "replay")
    const times = this.#messageTimes.get(input.identityId)!.filter((timestamp) => now - timestamp < 60_000)
    if (times.length >= this.#policy.maxMessagesPerMinute) return this.#deny(input.identityId, "rate-limit")
    const payload = `${identity.providerId}:${input.message.id}:${input.message.channelId}:${input.message.userId}:${input.message.timestamp}:${input.message.text}`
    if (!this.#verifier.verify(payload, input.signature)) return this.#deny(input.identityId, "signature")
    nonces.set(input.nonce, now)
    times.push(now)
    this.#messageTimes.set(input.identityId, times)
    this.#audit.record({ type: "message", identityId: input.identityId })
    return true
  }
  authorizeCommand(identityId: string, command: RemoteCommand): RemoteCommandResult {
    if (!this.#validIdentity(identityId)) return { commandId: command.id, status: "denied", result: "identity-invalid" }
    const capability = command.metadata?.capability
    if (!capability || command.metadata?.mode === "read-only") return { commandId: command.id, status: "accepted" }
    const approvals = this.#approvals
    if (!approvals) return { commandId: command.id, status: "denied", result: "approval-broker-required" }
    const resource = `${identityId}:${command.scope}`
    const existing = approvals.find(capability, resource)
    if (existing?.status === "allow") return { commandId: command.id, status: "accepted" }
    const approval = existing?.id ? existing : approvals.request(capability, resource, this.#now() + 30_000)
    this.#audit.record({ type: "approval", identityId, reason: capability })
    return { commandId: command.id, status: "pending-approval", result: { approvalId: approval.id } }
  }
  resolveApproval(id: string, decision: "allow" | "deny", actor: string): unknown {
    if (!this.#approvals?.resolve) throw new Error("approval broker is unavailable")
    return this.#approvals.resolve(id, decision, actor)
  }
  #validIdentity(identityId: string): RemoteIdentity | undefined {
    const identity = this.#identities.get(identityId)
    if (!identity || identity.expiresAt !== undefined && identity.expiresAt <= this.#now()) return undefined
    return identity
  }
  #deny(identityId: string, reason: string): false {
    this.#audit.record({ type: reason === "replay" ? "replay" : "deny", identityId, reason })
    return false
  }
}
