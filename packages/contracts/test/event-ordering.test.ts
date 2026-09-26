/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { validateEventOrdering, validateFixtureTraces, type EventOrderingFixture, type OrderingCheckEvent } from "../src/event-ordering"

async function loadFixture(): Promise<EventOrderingFixture> {
  return (await Bun.file(new URL("../../voice-core/fixtures/event-ordering.json", import.meta.url)).json()) as EventOrderingFixture
}

function kindsOf(fixture: EventOrderingFixture, trace: string): OrderingCheckEvent[] {
  const found = fixture.traces.find((entry) => entry.name === trace)
  if (!found) throw new Error(`missing trace ${trace}`)
  return found.events.map((event) => ({ kind: event.kind as string }))
}

describe("event ordering fixture", () => {
  test("canonical traces validate with zero violations", async () => {
    const fixture = await loadFixture()
    expect(validateFixtureTraces(fixture)).toEqual([])
  })

  test("reordered traces violate precedence", async () => {
    const fixture = await loadFixture()
    const events = kindsOf(fixture, "sessionTurn")
    const reordered = [...events]
    const preparing = reordered.findIndex((event) => event.kind === "voice_preparing")
    const ready = reordered.findIndex((event) => event.kind === "voice_ready")
    ;[reordered[preparing], reordered[ready]] = [reordered[ready]!, reordered[preparing]!]
    const violations = validateEventOrdering(reordered, fixture)
    expect(violations.some((violation) => violation.includes("voice_preparing") && violation.includes("voice_ready"))).toBe(true)
  })

  test("sequence regressions and generation drift are rejected", async () => {
    const fixture = await loadFixture()
    const events = fixture.traces[0]!.events.map((event) => ({
      kind: event.kind as string,
      seq: event.seq as number,
      ts: event.ts as number,
      generation: event.generation as number,
    }))
    const regressed = events.map((event, index) => (index === 5 ? { ...event, seq: 0 } : event))
    expect(validateEventOrdering(regressed, fixture).some((violation) => violation.includes("does not increase"))).toBe(true)

    const drifted = events.map((event, index) => (index === 5 ? { ...event, generation: 2 } : event))
    expect(validateEventOrdering(drifted, fixture).some((violation) => violation.includes("differs"))).toBe(true)
  })

  test("kind-only emitter traces still enforce precedence", async () => {
    const fixture = await loadFixture()
    const emitterTrace: OrderingCheckEvent[] = [
      { kind: "turn_submitted" },
      { kind: "agent_thinking" },
      { kind: "assistant_text_delta" },
      { kind: "assistant_text_final" },
      { kind: "turn_complete" },
    ]
    expect(validateEventOrdering(emitterTrace, fixture)).toEqual([])
    const violated = [emitterTrace[3]!, emitterTrace[0]!, ...emitterTrace.slice(1, 3), emitterTrace[4]!]
    expect(validateEventOrdering(violated, fixture).length).toBeGreaterThan(0)
  })
})
