/* SPDX-License-Identifier: MIT */
/**
 * Language-neutral canonical event-ordering rules.
 *
 * The fixture `packages/voice-core/fixtures/event-ordering.json` (generated
 * by `scripts/voice/generate-event-ordering-fixture.py`) is the shared
 * source of truth: Rust (`src/event.rs`), Python (`tests/test_event_ordering.py`)
 * and this module all validate the same bytes, and the app's local/Android
 * producer feeds its actually-published kinds through the same precedence
 * rules (`event-ordering-parity.test.ts`).
 */

export interface EventOrderingRule {
  before: string
  after: string
}

export interface EventOrderingInvariants {
  sequenceStrictlyIncreasing: boolean
  timestampNonDecreasing: boolean
  oneGenerationPerTrace: boolean
  oneSessionPerTrace: boolean
}

export interface EventOrderingTrace {
  name: string
  events: ReadonlyArray<Readonly<Record<string, unknown>>>
}

export interface EventOrderingFixture {
  version: number
  source: string
  reference: string
  invariants: EventOrderingInvariants
  precedence: ReadonlyArray<EventOrderingRule>
  traces: ReadonlyArray<EventOrderingTrace>
}

export interface OrderingCheckEvent {
  kind: string
  seq?: number
  ts?: number
  generation?: number
  sessionID?: string
}

function toCheckEvent(event: Record<string, unknown>): OrderingCheckEvent {
  const kind = typeof event.kind === "string" ? event.kind : undefined
  if (kind === undefined) throw new Error("ordering event is missing a string kind")
  const check: OrderingCheckEvent = { kind }
  if (typeof event.seq === "number") check.seq = event.seq
  if (typeof event.ts === "number") check.ts = event.ts
  if (typeof event.generation === "number") check.generation = event.generation
  if (typeof event.sessionID === "string") check.sessionID = event.sessionID
  return check
}

/** Returns every ordering violation in `events`, empty when the ordering is canonical. */
export function validateEventOrdering(
  events: ReadonlyArray<OrderingCheckEvent>,
  fixture: Pick<EventOrderingFixture, "invariants" | "precedence">,
): string[] {
  const violations: string[] = []
  let previousSequence: number | undefined
  let previousTimestamp: number | undefined
  let generation: number | undefined
  let session: string | undefined

  events.forEach((event, index) => {
    if (fixture.invariants.sequenceStrictlyIncreasing && event.seq !== undefined) {
      if (previousSequence !== undefined && event.seq <= previousSequence) {
        violations.push(`[${index}] ${event.kind}: seq ${event.seq} does not increase past ${previousSequence}`)
      }
      previousSequence = event.seq
    }
    if (fixture.invariants.timestampNonDecreasing && event.ts !== undefined) {
      if (previousTimestamp !== undefined && event.ts < previousTimestamp) {
        violations.push(`[${index}] ${event.kind}: ts ${event.ts} regresses past ${previousTimestamp}`)
      }
      previousTimestamp = event.ts
    }
    if (fixture.invariants.oneGenerationPerTrace && event.generation !== undefined) {
      if (generation === undefined) generation = event.generation
      else if (generation !== event.generation) {
        violations.push(`[${index}] ${event.kind}: generation ${event.generation} differs from ${generation}`)
      }
    }
    if (fixture.invariants.oneSessionPerTrace && event.sessionID !== undefined) {
      if (session === undefined) session = event.sessionID
      else if (session !== event.sessionID) {
        violations.push(`[${index}] ${event.kind}: sessionID ${event.sessionID} differs from ${session}`)
      }
    }
  })

  const firstIndex = new Map<string, number>()
  events.forEach((event, index) => {
    if (!firstIndex.has(event.kind)) firstIndex.set(event.kind, index)
  })
  for (const rule of fixture.precedence) {
    const before = firstIndex.get(rule.before)
    const after = firstIndex.get(rule.after)
    if (before !== undefined && after !== undefined && before >= after) {
      violations.push(`${rule.before} (index ${before}) must precede ${rule.after} (index ${after})`)
    }
  }
  return violations
}

/** Convenience check over fixture traces; returns "traceName: violation" strings. */
export function validateFixtureTraces(fixture: EventOrderingFixture): string[] {
  const violations: string[] = []
  for (const trace of fixture.traces) {
    for (const violation of validateEventOrdering(trace.events.map(toCheckEvent), fixture)) {
      violations.push(`${trace.name}: ${violation}`)
    }
  }
  return violations
}
