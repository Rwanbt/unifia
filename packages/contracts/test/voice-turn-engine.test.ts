/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import type { EventOrderingFixture } from "../src/event-ordering"
import {
  validateVoiceEvent,
  voiceEventKinds,
  type VoiceEvent,
  type VoiceEventKindName,
} from "../src/voice-turn-engine"

async function loadFixture(): Promise<EventOrderingFixture> {
  return (await Bun.file(new URL("../../voice-core/fixtures/event-ordering.json", import.meta.url)).json()) as EventOrderingFixture
}

async function loadAdrUnion(): Promise<string> {
  const text = await Bun.file(new URL("../../../docs/adr/ADR-060-voice-turn-engine-design.md", import.meta.url)).text()
  const start = text.indexOf("export type VoiceEvent =")
  if (start < 0) throw new Error("ADR-060 must project export type VoiceEvent")
  const rest = text.slice(start)
  const end = rest.indexOf("```")
  if (end < 0) throw new Error("VoiceEvent union stays inside a fence")
  return rest.slice(0, end)
}

function adrKinds(block: string): string[] {
  const kinds: string[] = []
  const pattern = /kind: "([a-z_]+)"/g
  for (const match of block.matchAll(pattern)) kinds.push(match[1]!)
  return kinds
}

function fixtureKinds(fixture: EventOrderingFixture): string[] {
  const kinds = new Set<string>()
  for (const rule of fixture.precedence) {
    kinds.add(rule.before)
    kinds.add(rule.after)
  }
  for (const trace of fixture.traces) {
    for (const event of trace.events) kinds.add(event.kind as string)
  }
  return [...kinds].sort()
}

type EventKindOf<T> = T extends { kind: infer K } ? K : never
type ContractKinds = EventKindOf<VoiceEvent>
type MissingKinds = Exclude<VoiceEventKindName, ContractKinds>
type UnknownKinds = Exclude<ContractKinds, VoiceEventKindName>
const _missingKinds: MissingKinds extends never ? true : never = true
const _unknownKinds: UnknownKinds extends never ? true : never = true

describe("voice turn engine contract", () => {
  test("lists exactly the canonical 29 kinds without duplicates", () => {
    expect(voiceEventKinds.length).toBe(29)
    expect(new Set(voiceEventKinds).size).toBe(29)
  })

  test("every kind referenced by the shared ordering fixture exists in the contract", async () => {
    const fixture = await loadFixture()
    const referenced = fixtureKinds(fixture)
    expect(referenced.length).toBeGreaterThan(0)
    for (const kind of referenced) {
      expect(voiceEventKinds.includes(kind as never)).toBe(true)
    }
  })

  test("ADR-060 projection lists the same kinds in the same order", async () => {
    const block = await loadAdrUnion()
    expect(adrKinds(block)).toEqual([...voiceEventKinds])
    expect(block.match(/generation: number/g)?.length).toBe(voiceEventKinds.length)
  })

  test("representative events satisfy the wire-shaped union", () => {
    const ready = {
      sessionID: "ses_contract_test",
      ts: 10,
      seq: 0,
      generation: 1,
      kind: "voice_ready",
      profile: "live",
      capabilities: ["stt", "tts"],
      language: "en",
      voice: "en-default",
      locale_source: "stt-final",
    } satisfies VoiceEvent
    const submitted = {
      sessionID: "ses_contract_test",
      turnID: "turn_contract_1",
      ts: 20,
      seq: 1,
      generation: 1,
      kind: "turn_submitted",
      message_id: "msg_contract_1",
    } satisfies VoiceEvent
    const error = {
      bindingID: "lvb_0123456789abcdefghijklmnopqrstuv",
      turnID: "turn_contract_1",
      ts: 30,
      seq: 2,
      generation: 1,
      kind: "voice_error",
      stage: "stt",
      code: "STT_PROVIDER_UNAVAILABLE",
      recoverable: true,
      cause_category: "provider",
      detail: "An unclassified Voice runtime failure occurred.",
    } satisfies VoiceEvent
    expect(validateVoiceEvent(ready)).toEqual([])
    expect(validateVoiceEvent(submitted)).toEqual([])
    expect(validateVoiceEvent(error)).toEqual([])
  })

  test("every shared-fixture event passes the contract validator", async () => {
    const fixture = await loadFixture()
    for (const trace of fixture.traces) {
      for (const event of trace.events) {
        expect(validateVoiceEvent(event)).toEqual([])
      }
    }
  })

  test("validator mirrors the Rust envelope, identity, and payload rules", () => {
    const base = { sessionID: "ses_contract_test", ts: 1, seq: 0, generation: 1 }

    expect(validateVoiceEvent({ ...base, kind: "unknown_kind" })).toEqual([
      "unknown event kind: unknown_kind",
    ])
    expect(validateVoiceEvent({ ...base, kind: "speech_started" })).toEqual([
      "speech_started requires turnID",
    ])
    expect(
      validateVoiceEvent({ ...base, turnID: "turn_1", kind: "speech_started" }),
    ).toEqual([])
    expect(
      validateVoiceEvent({
        ts: 1,
        seq: 0,
        generation: 1,
        bindingID: "lvb_0123456789abcdefghijklmnopqrstuv",
        kind: "voice_error",
        stage: "stt",
        code: "STT_PROVIDER_UNAVAILABLE",
        recoverable: true,
        cause_category: "provider",
        detail: "safe detail",
      }),
    ).toEqual([])
    expect(
      validateVoiceEvent({
        ts: 1,
        seq: 0,
        generation: 1,
        bindingID: "lvb_0123456789abcdefghijklmnopqrstuv",
        kind: "speech_started",
        turnID: "turn_1",
      }),
    ).toContain("bindingID identity is only allowed on voice_error")
    expect(
      validateVoiceEvent({
        ...base,
        sessionID: undefined,
        kind: "voice_stopped",
        reason: "user",
      }),
    ).toContain("exactly one of sessionID or bindingID is required")

    const unsafe = validateVoiceEvent({ ...base, ts: 2 ** 53, kind: "agent_thinking" })
    expect(unsafe.some((violation) => violation.includes("ts"))).toBe(true)

    expect(
      validateVoiceEvent({ ...base, turnID: "turn_1", kind: "vad_probability", value: 1.5 }),
    ).toContain("vad_probability.value must be a finite number in 0..=1")
    expect(
      validateVoiceEvent({ ...base, kind: "voice_preparing", profile: "turbo" }),
    ).toContain("voice_preparing.profile must be one of dictation, manual_read_aloud, live")
    expect(
      validateVoiceEvent({
        ...base,
        turnID: "turn_1",
        kind: "voice_error",
        stage: "stt",
        code: "TTS_PROVIDER_UNAVAILABLE",
        recoverable: true,
        cause_category: "provider",
        detail: "safe detail",
      }),
    ).toContain("voice_error.code TTS_PROVIDER_UNAVAILABLE does not match stage stt")
    expect(
      validateVoiceEvent({
        ...base,
        turnID: "turn_1",
        kind: "tts_audio",
        segment: 0,
        pcm: [0.5],
        sample_rate_hz: 24_000,
        channels: 1,
      }),
    ).toContain("tts_audio.pcm must be an array of i16 samples")
    expect(
      validateVoiceEvent({ ...base, turnID: "turn_1", kind: "assistant_text_delta" }),
    ).toContain("assistant_text_delta requires delta")
  })
})
