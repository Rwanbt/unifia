import { describe, expect, test } from "bun:test"
import { aggregateHealth, buildRateLimit } from "../../src/model-intelligence/health"
import type { HealthObservation } from "../../src/model-intelligence/health"

describe("health aggregation", () => {
  test("empty observations returns baseline", () => {
    const h = aggregateHealth([])
    expect(h.availabilityScore).toBe(1)
    expect(h.errorRate1h).toBe(0)
    expect(h.latencyP50Ms).toBeNull()
    expect(h.latencyP95Ms).toBeNull()
  })

  test("computes error rate from observations", () => {
    const observations: HealthObservation[] = [
      { timestampUTC: "2026-07-21T00:00:00Z", latencyMs: 100, error: false },
      { timestampUTC: "2026-07-21T00:01:00Z", latencyMs: 200, error: true },
      { timestampUTC: "2026-07-21T00:02:00Z", latencyMs: 150, error: false },
      { timestampUTC: "2026-07-21T00:03:00Z", latencyMs: 300, error: true },
    ]
    const h = aggregateHealth(observations)
    expect(h.errorRate1h).toBe(0.5)
    expect(h.availabilityScore).toBe(0.5)
  })

  test("computes p50 and p95 latency", () => {
    const observations: HealthObservation[] = Array.from({ length: 100 }, (_, i) => ({
      timestampUTC: "2026-07-21T00:00:00Z",
      latencyMs: i * 10,
      error: false,
    }))
    const h = aggregateHealth(observations)
    expect(h.latencyP50Ms).not.toBeNull()
    expect(h.latencyP95Ms).not.toBeNull()
    expect(h.latencyP50Ms!).toBeLessThanOrEqual(h.latencyP95Ms!)
  })

  test("ignores null latency in percentile calc", () => {
    const observations: HealthObservation[] = [
      { timestampUTC: "2026-07-21T00:00:00Z", latencyMs: null, error: false },
      { timestampUTC: "2026-07-21T00:01:00Z", latencyMs: 100, error: false },
      { timestampUTC: "2026-07-21T00:02:00Z", latencyMs: 200, error: false },
    ]
    const h = aggregateHealth(observations)
    expect(h.latencyP50Ms).not.toBeNull()
    expect(h.latencyP95Ms).not.toBeNull()
  })

  test("buildRateLimit constructs RateLimit object", () => {
    const rl = buildRateLimit(60, 100_000, "per_minute")
    expect(rl.requestsPerMinute).toBe(60)
    expect(rl.tokensPerMinute).toBe(100_000)
    expect(rl.resetWindow).toBe("per_minute")
  })
})