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
