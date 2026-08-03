/**
 * RuntimeAdapter — abstraction sur le runtime agentique
 * (OpenCode legacy ou Unifia)
 *
 * ADR-0001
 * Source : Plan V3 §7.1
 */
export type RuntimeId = "opencode" | "unifia" | "fake"

export interface RuntimeInfo {
  id: RuntimeId
  version: string
  capabilities: string[]
  healthy: boolean
}

export interface Session {
  id: string
  workspaceId: string
  runtimeId: RuntimeId
  createdAt: number
  messageCount: number
}

export interface SendPromptInput {
  sessionId: string
  prompt: string
  capabilities?: string[]
}

export interface RuntimeEvent {
  sessionId: string
  type: "text" | "tool-call" | "tool-result" | "permission" | "error"
  data: unknown
  timestamp: number
  sequence?: number
}

export interface RuntimeAdapter {
  getInfo(): Promise<RuntimeInfo>
  listSessions(scope: WorkspaceScope): Promise<Session[]>
  createSession(input: { workspaceId: string }): Promise<Session>
  sendPrompt(input: SendPromptInput): Promise<void>
  subscribeEvents(input: { sessionId: string; afterSequence?: number }): AsyncIterable<RuntimeEvent>
  cancelSession(sessionId: string): Promise<void>
}

export interface WorkspaceScope {
  workspaceId: string
  includeArchived?: boolean
}