/* SPDX-License-Identifier: MIT */
import type { LiveVoiceState } from "@unifia/contracts/speech"
import { isLiveActive, type LiveSnapshot } from "./live-state"

/**
 * The topbar orb's motion states (Jarvis topbar prototype V5). `off` is static
 * and neutral; every other state animates in shades of the accent colour.
 */
export type LiveOrbVisual = "off" | "idle" | "listening" | "thinking" | "working" | "speaking" | "attention"

/** Where a peek row stands: settled, in progress, or waiting on the user. */
export type LiveOrbRowTone = "done" | "active" | "pending" | "blocked"

export interface LiveOrbRow {
  id: "host" | "agent" | "human"
  tone: LiveOrbRowTone
  /** i18n key of the row's value. */
  value: string
}

export interface LiveOrbView {
  visual: LiveOrbVisual
  /** i18n keys of the peek's title and detail lines. */
  title: string
  detail: string
  /** The agent is producing something: the peek shows an activity bar. */
  busy: boolean
  rows: LiveOrbRow[]
}

export function liveOrbVisual(state: LiveVoiceState, snapshot: LiveSnapshot): LiveOrbVisual {
  if (!isLiveActive(state)) return "off"
  // A pending permission or question outranks everything: the agent is blocked on the user.
  if (snapshot.attention) return "attention"
  switch (state) {
    case "connecting":
    case "reconnecting":
    case "processing":
    case "thinking":
      return "thinking"
    case "working":
      return "working"
    case "speaking":
      return "speaking"
    default:
      return snapshot.userSpeaking ? "listening" : "idle"
  }
}

function hostRow(snapshot: LiveSnapshot): LiveOrbRow {
  if (snapshot.connection === "connected" && snapshot.agent !== "initializing")
    return { id: "host", tone: "done", value: "live.orb.row.host.connected" }
  if (snapshot.connection === "reconnecting")
    return { id: "host", tone: "active", value: "live.orb.row.host.reconnecting" }
  return { id: "host", tone: "active", value: "live.orb.row.host.connecting" }
}

function agentRow(snapshot: LiveSnapshot): LiveOrbRow {
  if (snapshot.task === "working") return { id: "agent", tone: "active", value: "live.orb.row.agent.working" }
  if (snapshot.task === "thinking" || snapshot.agent === "thinking")
    return { id: "agent", tone: "active", value: "live.orb.row.agent.thinking" }
  if (snapshot.agent === "speaking") return { id: "agent", tone: "active", value: "live.orb.row.agent.speaking" }
  return { id: "agent", tone: "pending", value: "live.orb.row.agent.idle" }
}

function humanRow(snapshot: LiveSnapshot): LiveOrbRow {
  if (snapshot.attention === "permission")
    return { id: "human", tone: "blocked", value: "live.orb.row.human.permission" }
  if (snapshot.attention === "question") return { id: "human", tone: "blocked", value: "live.orb.row.human.question" }
  return { id: "human", tone: "pending", value: "live.orb.row.human.free" }
}

/** Everything the orb and its peek render, derived from the Live store only. */
export function liveOrbView(state: LiveVoiceState, snapshot: LiveSnapshot): LiveOrbView {
  const visual = liveOrbVisual(state, snapshot)
  const copy =
    visual === "attention"
      ? `live.orb.copy.attention.${snapshot.attention}`
      : visual === "off"
        ? "live.orb.copy.off"
        : `live.orb.copy.${state}`
  return {
    visual,
    title: `${copy}.title`,
    detail: `${copy}.detail`,
    busy: visual === "thinking" || visual === "working",
    rows: visual === "off" ? [] : [hostRow(snapshot), agentRow(snapshot), humanRow(snapshot)],
  }
}
