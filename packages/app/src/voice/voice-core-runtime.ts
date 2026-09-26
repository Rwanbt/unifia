/* SPDX-License-Identifier: MIT */

export type VoiceCoreEvent =
  | { kind: "turn_submitted"; message_id: string }
  | { kind: "agent_thinking" }
  | { kind: "agent_working"; tool: string | null }
  | { kind: "tool_started"; tool: string }
  | { kind: "tool_finished"; tool: string; outcome: "ok" | "denied" | "errored" }
  | { kind: "permission_required"; permission: string }
  | { kind: "assistant_text_final"; text: string }

export interface VoiceCoreRuntimeClient {
  openSession(sessionID: string): Promise<number>
  beginTurn(sessionID: string, turnID: string): Promise<void>
  publish(sessionID: string, turnID: string | undefined, event: VoiceCoreEvent): Promise<unknown>
  publishTextDelta(sessionID: string, turnID: string, delta: string): Promise<unknown>
  closeSession(sessionID: string): Promise<void>
}

/** Adapts Android's Tauri commands to the shared durable VoiceCore owner. */
export function createTauriVoiceCoreRuntime(
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>,
): VoiceCoreRuntimeClient {
  return {
    async openSession(sessionID) {
      return await invoke("voice_core_open_session", { sessionId: sessionID }) as number
    },
    async beginTurn(sessionID, turnID) {
      await invoke("voice_core_begin_turn", { sessionId: sessionID, turnId: turnID })
    },
    async publish(sessionID, turnID, event) {
      return await invoke("voice_core_publish", { sessionId: sessionID, turnId: turnID, event })
    },
    async publishTextDelta(sessionID, turnID, delta) {
      return await invoke("voice_core_publish_text_delta", { sessionId: sessionID, turnId: turnID, delta })
    },
    async closeSession(sessionID) {
      await invoke("voice_core_close_session", { sessionId: sessionID })
    },
  }
}
