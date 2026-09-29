/* SPDX-License-Identifier: MIT */
/**
 * Canonical VoiceTurnEngine contract (ADR-060, spec 11) — the real types
 * behind the historical ADR prose, kept in sync with `packages/voice-core`.
 *
 * - `VoiceEventInput` mirrors the serde-serialized `VoiceEventKind`
 *   (`kind` tag + snake_case payload, no envelope).
 * - `VoiceEvent` adds the envelope serialized by `VoiceEvent`
 *   (`sessionID`/`bindingID`/`turnID`/`ts`/`seq`/`generation`).
 * - `VoiceTurnEngine` mirrors the Tauri commands in
 *   `packages/mobile/src-tauri/src/voice/voice_core.rs`.
 * - `validateVoiceEvent` mirrors `VoiceEvent::validate` in
 *   `packages/voice-core/src/event.rs` at the contract boundary.
 *
 * `voice-turn-engine.test.ts` enforces kind parity with the ADR-060
 * projection and the shared event-ordering fixture; the Rust test
 * `adr_060_projection_matches_voice_event_kinds` enforces the same list
 * against the Rust enum.
 */

import type { SpeechLanguage, VoiceErrorCauseCategory, VoiceErrorStage } from "./speech.js"
import {
  speechLanguages,
  voiceErrorCauseCategories,
  voiceErrorCodeMatchesStage,
  voiceErrorCodeStages,
  voiceErrorStages,
} from "./speech.js"

export const voiceProfiles = ["dictation", "manual_read_aloud", "live"] as const
export type VoiceProfile = (typeof voiceProfiles)[number]

export const localeSources = [
  "user",
  "stt-final",
  "conversation",
  "application",
  "fallback-english",
] as const
export type LocaleSource = (typeof localeSources)[number]

export const toolOutcomes = ["ok", "denied", "errored"] as const
export type ToolOutcome = (typeof toolOutcomes)[number]

export const turnCancelReasons = ["user-barge", "agent-cancel", "error", "route-change"] as const
export type TurnCancelReason = (typeof turnCancelReasons)[number]

export const audioRoutes = [
  "speaker",
  "wired-headset",
  "usb-headset",
  "bluetooth-hfp",
  "bluetooth-a2dp",
  "bluetooth-le-audio",
  "unknown",
] as const
export type AudioRoute = (typeof audioRoutes)[number]

export const resourcePressureKinds = ["memory", "cpu", "thermal", "network"] as const
export type ResourcePressureKind = (typeof resourcePressureKinds)[number]

export const stopReasons = ["user", "session-ended", "error", "process-shutdown"] as const
export type StopReason = (typeof stopReasons)[number]

export const voiceEventKinds = [
  "voice_preparing",
  "voice_ready",
  "speech_started",
  "speech_ended",
  "vad_probability",
  "turn_incomplete",
  "turn_complete",
  "stt_partial",
  "stt_final",
  "turn_submitted",
  "agent_thinking",
  "agent_working",
  "tool_started",
  "tool_finished",
  "permission_required",
  "assistant_text_delta",
  "assistant_text_final",
  "speech_segment_ready",
  "tts_started",
  "tts_audio",
  "tts_cancelled",
  "assistant_speaking",
  "assistant_interrupted",
  "audio_route_changed",
  "provider_fallback",
  "resource_pressure",
  "voice_recovering",
  "voice_error",
  "voice_stopped",
] as const
export type VoiceEventKindName = (typeof voiceEventKinds)[number]

/** Payload sent to `voice_core_publish` (serde `VoiceEventKind`, no envelope). */
export type VoiceEventInput =
  | { kind: "voice_preparing"; profile: VoiceProfile }
  | {
      kind: "voice_ready"
      profile: VoiceProfile
      capabilities: string[]
      language: SpeechLanguage
      voice: string
      locale_source: LocaleSource
    }
  | { kind: "speech_started" }
  | { kind: "speech_ended" }
  | { kind: "vad_probability"; value: number }
  | { kind: "turn_incomplete" }
  | { kind: "turn_complete"; transcript: string; confidence?: number }
  | { kind: "stt_partial"; text: string; stable: boolean }
  | { kind: "stt_final"; text: string; language: SpeechLanguage }
  | { kind: "turn_submitted"; message_id: string }
  | { kind: "agent_thinking" }
  | { kind: "agent_working"; tool?: string }
  | { kind: "tool_started"; tool: string }
  | { kind: "tool_finished"; tool: string; outcome: ToolOutcome }
  | { kind: "permission_required"; permission: string }
  | { kind: "assistant_text_delta"; delta: string }
  | { kind: "assistant_text_final"; text: string }
  | { kind: "speech_segment_ready"; text: string; voice: string; language: SpeechLanguage }
  | { kind: "tts_started"; segment: number }
  | { kind: "tts_audio"; segment: number; pcm: number[]; sample_rate_hz: number; channels: number }
  | { kind: "tts_cancelled"; segment: number; reason: TurnCancelReason }
  | { kind: "assistant_speaking" }
  | { kind: "assistant_interrupted" }
  | { kind: "audio_route_changed"; route: AudioRoute; interrupted: boolean }
  | { kind: "provider_fallback"; from: string; to: string; reason: string }
  | { kind: "resource_pressure"; pressure: ResourcePressureKind }
  | { kind: "voice_recovering"; stage: string }
  | {
      kind: "voice_error"
      stage: VoiceErrorStage
      code: string
      recoverable: boolean
      cause_category: VoiceErrorCauseCategory
      provider_id?: string
      detail: string
      retry_after_ms?: number
    }
  | { kind: "voice_stopped"; reason: StopReason }

export interface VoiceEventEnvelope {
  sessionID?: string
  bindingID?: string
  turnID?: string
  ts: number
  seq: number
  generation: number
}

export type VoiceEvent = VoiceEventEnvelope & VoiceEventInput

/** Real control surface owned by VoiceCore (Tauri commands, ADR-060). */
export interface VoiceTurnEngine {
  openSession(sessionID: string): Promise<number>
  remainingTurnCapacity(sessionID: string): Promise<number>
  beginTurn(sessionID: string, turnID: string): Promise<void>
  publish(
    sessionID: string,
    turnID: string | undefined,
    event: VoiceEventInput,
  ): Promise<VoiceEvent>
  publishTextDelta(sessionID: string, turnID: string, delta: string): Promise<VoiceEvent>
  closeSession(sessionID: string): Promise<void>
}

/** Kinds that must carry `turnID` (`VoiceEventKind::requires_turn_id`). */
const turnScopedKinds = new Set<VoiceEventKindName>([
  "speech_started",
  "speech_ended",
  "turn_incomplete",
  "turn_complete",
  "stt_partial",
  "stt_final",
  "turn_submitted",
  "agent_thinking",
  "agent_working",
  "tool_started",
  "tool_finished",
  "permission_required",
  "assistant_text_delta",
  "assistant_text_final",
  "speech_segment_ready",
  "tts_started",
  "tts_audio",
  "tts_cancelled",
  "assistant_speaking",
  "assistant_interrupted",
])

type FieldKind = "string" | "number" | "boolean" | "array"

const requiredFields: Partial<Record<VoiceEventKindName, Readonly<Record<string, FieldKind>>>> = {
  voice_preparing: { profile: "string" },
  voice_ready: {
    profile: "string",
    capabilities: "array",
    language: "string",
    voice: "string",
    locale_source: "string",
  },
  vad_probability: { value: "number" },
  turn_complete: { transcript: "string" },
  stt_partial: { text: "string", stable: "boolean" },
  stt_final: { text: "string", language: "string" },
  turn_submitted: { message_id: "string" },
  tool_started: { tool: "string" },
  tool_finished: { tool: "string", outcome: "string" },
  permission_required: { permission: "string" },
  assistant_text_delta: { delta: "string" },
  assistant_text_final: { text: "string" },
  speech_segment_ready: { text: "string", voice: "string", language: "string" },
  tts_started: { segment: "number" },
  tts_audio: { segment: "number", pcm: "array", sample_rate_hz: "number", channels: "number" },
  tts_cancelled: { segment: "number", reason: "string" },
  audio_route_changed: { route: "string", interrupted: "boolean" },
  provider_fallback: { from: "string", to: "string", reason: "string" },
  resource_pressure: { pressure: "string" },
  voice_recovering: { stage: "string" },
  voice_error: {
    stage: "string",
    code: "string",
    recoverable: "boolean",
    cause_category: "string",
    detail: "string",
  },
  voice_stopped: { reason: "string" },
}

const optionalFields: Partial<Record<VoiceEventKindName, Readonly<Record<string, FieldKind>>>> = {
  turn_complete: { confidence: "number" },
  agent_working: { tool: "string" },
  voice_error: { provider_id: "string", retry_after_ms: "number" },
}

function matchesFieldKind(value: unknown, kind: FieldKind): boolean {
  switch (kind) {
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number"
    case "boolean":
      return typeof value === "boolean"
    case "array":
      return Array.isArray(value)
  }
}

function fieldViolations(
  payload: Record<string, unknown>,
  kind: VoiceEventKindName,
  fields: Readonly<Record<string, FieldKind>> | undefined,
  optional: boolean,
): string[] {
  const violations: string[] = []
  for (const [field, expected] of Object.entries(fields ?? {})) {
    const value = payload[field]
    if (value === undefined) {
      if (!optional) violations.push(`${kind} requires ${field}`)
      continue
    }
    if (value === null || !matchesFieldKind(value, expected)) {
      violations.push(`${kind}.${field} must be a ${expected}`)
    }
  }
  return violations
}

function enumViolation(
  payload: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
): string | undefined {
  const value = payload[field]
  if (typeof value === "string" && !allowed.includes(value)) {
    return `${field} must be one of ${allowed.join(", ")}`
  }
  return undefined
}

function identityViolations(value: VoiceEvent): string[] {
  const violations: string[] = []
  const hasSession = value.sessionID !== undefined
  const hasBinding = value.bindingID !== undefined
  if (hasSession === hasBinding) {
    violations.push("exactly one of sessionID or bindingID is required")
    return violations
  }
  if (hasSession) {
    const id = value.sessionID as string
    if (!id.startsWith("ses_") || id.length <= 4 || id.length > 128) {
      violations.push("sessionID must start with ses_ and be 5..=128 characters")
    }
  } else {
    const id = value.bindingID as string
    if (id.length !== 36 || !id.startsWith("lvb_") || !/^lvb_[A-Za-z0-9]+$/.test(id)) {
      violations.push("bindingID must be lvb_ plus 32 alphanumeric characters")
    }
    if (value.kind !== "voice_error") {
      violations.push("bindingID identity is only allowed on voice_error")
    }
  }
  return violations
}

/**
 * Mirrors `VoiceEvent::validate` (packages/voice-core/src/event.rs) for the
 * envelope, identity, turn rules, and payload sanity checks. Returns the list
 * of violations; an empty list means the event is acceptable at the boundary.
 */
export function validateVoiceEvent(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["event must be an object"]
  }
  const event = value as Partial<VoiceEvent> & { kind?: string }

  if (typeof event.kind !== "string" || !voiceEventKinds.includes(event.kind as never)) {
    return [`unknown event kind: ${String(event.kind)}`]
  }
  const kind = event.kind as VoiceEventKindName
  const violations: string[] = []

  for (const field of ["ts", "seq", "generation"] as const) {
    const number = event[field]
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
      violations.push(`${field} must be a non-negative JavaScript-safe integer`)
    }
  }

  violations.push(...identityViolations(value as VoiceEvent))

  const turnID = event.turnID
  if (turnID !== undefined) {
    if (typeof turnID !== "string" || turnID.trim().length === 0 || turnID.length > 128) {
      violations.push("turnID must be a non-empty string of at most 128 characters")
    }
  }
  if (turnScopedKinds.has(kind) && turnID === undefined) {
    violations.push(`${kind} requires turnID`)
  }

  const payload = event as unknown as Record<string, unknown>
  violations.push(...fieldViolations(payload, kind, requiredFields[kind], false))
  violations.push(...fieldViolations(payload, kind, optionalFields[kind], true))

  if (kind === "voice_preparing" || kind === "voice_ready") {
    const profile = enumViolation(payload, "profile", voiceProfiles)
    if (profile) violations.push(`${kind}.${profile}`)
  }
  if (kind === "voice_ready") {
    const language = enumViolation(payload, "language", speechLanguages)
    if (language) violations.push(`voice_ready.${language}`)
    const locale = enumViolation(payload, "locale_source", localeSources)
    if (locale) violations.push(`voice_ready.${locale}`)
    const capabilities = payload.capabilities
    if (
      Array.isArray(capabilities) &&
      !capabilities.every((item) => typeof item === "string")
    ) {
      violations.push("voice_ready.capabilities must be an array of strings")
    }
  }
  if (kind === "stt_final" || kind === "speech_segment_ready") {
    const language = enumViolation(payload, "language", speechLanguages)
    if (language) violations.push(`${kind}.${language}`)
  }
  if (kind === "tool_finished") {
    const outcome = enumViolation(payload, "outcome", toolOutcomes)
    if (outcome) violations.push(`tool_finished.${outcome}`)
  }
  if (kind === "tts_cancelled") {
    const reason = enumViolation(payload, "reason", turnCancelReasons)
    if (reason) violations.push(`tts_cancelled.${reason}`)
  }
  if (kind === "audio_route_changed") {
    const route = enumViolation(payload, "route", audioRoutes)
    if (route) violations.push(`audio_route_changed.${route}`)
  }
  if (kind === "resource_pressure") {
    const pressure = enumViolation(payload, "pressure", resourcePressureKinds)
    if (pressure) violations.push(`resource_pressure.${pressure}`)
  }
  if (kind === "voice_stopped") {
    const reason = enumViolation(payload, "reason", stopReasons)
    if (reason) violations.push(`voice_stopped.${reason}`)
  }

  if (kind === "vad_probability") {
    const value = payload.value
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !(value >= 0 && value <= 1)
    ) {
      violations.push("vad_probability.value must be a finite number in 0..=1")
    }
  }
  if (kind === "turn_complete") {
    const confidence = payload.confidence
    if (
      confidence !== undefined &&
      (typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        !(confidence >= 0 && confidence <= 1))
    ) {
      violations.push("turn_complete.confidence must be a finite number in 0..=1")
    }
  }
  if (kind === "tts_audio") {
    const sampleRate = payload.sample_rate_hz
    if (typeof sampleRate !== "number" || !(sampleRate > 0)) {
      violations.push("tts_audio.sample_rate_hz must be a positive number")
    }
    const channels = payload.channels
    if (typeof channels !== "number" || !(channels > 0)) {
      violations.push("tts_audio.channels must be a positive number")
    }
    const pcm = payload.pcm
    if (
      Array.isArray(pcm) &&
      !pcm.every(
        (sample) =>
          typeof sample === "number" &&
          Number.isInteger(sample) &&
          sample >= -32_768 &&
          sample <= 32_767,
      )
    ) {
      violations.push("tts_audio.pcm must be an array of i16 samples")
    }
  }
  if (kind === "voice_error") {
    const stage = payload.stage
    if (typeof stage === "string" && !voiceErrorStages.includes(stage as never)) {
      violations.push(`voice_error.stage must be one of ${voiceErrorStages.join(", ")}`)
    }
    const cause = payload.cause_category
    if (typeof cause === "string" && !voiceErrorCauseCategories.includes(cause as never)) {
      violations.push(
        `voice_error.cause_category must be one of ${voiceErrorCauseCategories.join(", ")}`,
      )
    }
    const code = payload.code
    if (typeof code === "string") {
      if (!(code in voiceErrorCodeStages)) {
        violations.push(`voice_error.code ${code} is not in the catalog`)
      } else if (
        typeof stage === "string" &&
        voiceErrorStages.includes(stage as never) &&
        !voiceErrorCodeMatchesStage(stage as VoiceErrorStage, code)
      ) {
        violations.push(`voice_error.code ${code} does not match stage ${stage}`)
      }
    }
    const providerID = payload.provider_id
    if (
      providerID !== undefined &&
      (typeof providerID !== "string" ||
        providerID.length > 120 ||
        !/^[A-Za-z0-9._@:-]+$/.test(providerID))
    ) {
      violations.push("voice_error.provider_id must be <= 120 characters of [A-Za-z0-9._@:-]")
    }
    const retry = payload.retry_after_ms
    if (
      retry !== undefined &&
      (typeof retry !== "number" ||
        !Number.isSafeInteger(retry) ||
        retry < 0 ||
        retry > 86_400_000)
    ) {
      violations.push("voice_error.retry_after_ms must be a safe integer in 0..=86400000")
    }
  }

  return violations
}
