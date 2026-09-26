/* SPDX-License-Identifier: MIT */
import type { LiveVoiceError, LiveVoiceState } from "@unifia/contracts/speech"

/** Raw facts reported by the transport and the agent; the UI state is derived. */
export type LiveConnection = "idle" | "connecting" | "connected" | "reconnecting" | "error"
export type AgentPhase = "initializing" | "idle" | "listening" | "thinking" | "speaking"
export type AgentTask = "idle" | "thinking" | "working"

export interface LiveSnapshot {
  connection: LiveConnection
  agent: AgentPhase
  task: AgentTask
  userSpeaking: boolean
  /** The user stopped talking and no answer has started yet. */
  awaitingAnswer: boolean
  attention?: "permission" | "question"
  error?: LiveVoiceError
}

export type LiveEvent =
  | { type: "start" }
  | { type: "connected" }
  | { type: "reconnecting" }
  | { type: "reconnected" }
  | { type: "agent-state"; agent: AgentPhase }
  | { type: "agent-task"; task: AgentTask }
  | { type: "attention"; attention?: "permission" | "question" }
  | { type: "user-speaking"; speaking: boolean }
  | { type: "error"; error: LiveVoiceError }
  | { type: "stop" }
  /* R6 streaming parity (ADR-060): provider-neutral semantic events
     forwarded from AgentBridge so Android consumes the same live
     stream as desktop Live. Most are observability-only — the
     reducer returns snapshot unchanged — except `permission-required`
     which flips attention. */
  | { type: "tool-started"; tool: string; turnID: string }
  | { type: "tool-finished"; tool: string; turnID: string; outcome: "ok" | "denied" | "errored" }
  | { type: "agent-text-delta"; delta: string; turnID: string }
  | { type: "agent-text-final"; text: string; turnID: string }
  | { type: "permission-required"; permission: string; turnID: string }
  | { type: "stream-error"; stage: string; code: string; detail: string }

export const INITIAL_LIVE_SNAPSHOT: LiveSnapshot = {
  connection: "idle",
  agent: "initializing",
  task: "idle",
  userSpeaking: false,
  awaitingAnswer: false,
}

export function reduceLive(snapshot: LiveSnapshot, event: LiveEvent): LiveSnapshot {
  switch (event.type) {
    case "start":
      return { ...INITIAL_LIVE_SNAPSHOT, connection: "connecting" }
    case "connected":
    case "reconnected":
      if (snapshot.connection === "idle") return snapshot
      return { ...snapshot, connection: "connected", error: undefined }
    case "reconnecting":
      if (snapshot.connection === "idle" || snapshot.connection === "error") return snapshot
      return { ...snapshot, connection: "reconnecting", userSpeaking: false }
    case "agent-state": {
      const answering = event.agent === "thinking" || event.agent === "speaking"
      return { ...snapshot, agent: event.agent, awaitingAnswer: answering ? false : snapshot.awaitingAnswer }
    }
    case "agent-task":
      return { ...snapshot, task: event.task, awaitingAnswer: event.task === "idle" ? snapshot.awaitingAnswer : false }
    case "attention":
      return { ...snapshot, attention: event.attention }
    case "user-speaking":
      return {
        ...snapshot,
        userSpeaking: event.speaking,
        awaitingAnswer: event.speaking ? false : snapshot.userSpeaking || snapshot.awaitingAnswer,
      }
    case "error":
      return { ...snapshot, connection: "error", error: event.error, userSpeaking: false }
    case "stop":
      return INITIAL_LIVE_SNAPSHOT
    /* R6 streaming parity — observability events keep the snapshot
       intact; the controller owns accumulator state (text buffer,
       currentTurnID, etc.). Only `permission-required` mutates
       attention so the UI can surface the prompt. */
    case "permission-required":
      return { ...snapshot, attention: "permission" }
    case "tool-started":
    case "tool-finished":
    case "agent-text-delta":
    case "agent-text-final":
    case "stream-error":
      return snapshot
  }
}

/** The single state the Live button and status line render. */
export function deriveLiveState(snapshot: LiveSnapshot): LiveVoiceState {
  switch (snapshot.connection) {
    case "idle":
      return "idle"
    case "connecting":
      return "connecting"
    case "reconnecting":
      return "reconnecting"
    case "error":
      return "error"
  }
  if (snapshot.agent === "initializing") return "connecting"
  if (snapshot.agent === "speaking") return "speaking"
  if (snapshot.userSpeaking) return "listening"
  // Work keeps running while the microphone stays open (full duplex).
  if (snapshot.task === "working") return "working"
  if (snapshot.agent === "thinking" || snapshot.task === "thinking") return "thinking"
  if (snapshot.awaitingAnswer) return "processing"
  return "listening"
}

export function isLiveActive(state: LiveVoiceState): boolean {
  return state !== "idle" && state !== "error"
}
