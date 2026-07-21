/**
 * Health check : latence, taux d'erreur, rate limit, uptime.
 *
 * Calcul des métriques depuis observations ponctuelles. Pas de réseau réel
 * ici (c'est la responsabilité des connecteurs ou d'un health-checker
 * séparé).
 */

import type { ModelHealth, RateLimit } from "./schema"
import { isoUtcNow } from "./schema"

export interface HealthObservation {
  timestampUTC: string
  latencyMs: number | null
  error: boolean
}

export function aggregateHealth(observations: HealthObservation[]): ModelHealth {
  if (observations.length === 0) {
    return {
      lastHealthCheckUTC: isoUtcNow(),
      availabilityScore: 1,
      latencyP50Ms: null,
      latencyP95Ms: null,
      errorRate1h: 0,
      rateLimit: null,
      notes: null,
    }
  }

  const latencies = observations
    .map((o) => o.latencyMs)
    .filter((l): l is number => typeof l === "number")
    .sort((a, b) => a - b)

  const errors = observations.filter((o) => o.error).length

  return {
    lastHealthCheckUTC: isoUtcNow(),
    availabilityScore: 1 - errors / observations.length,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    errorRate1h: errors / observations.length,
    rateLimit: null,
    notes: null,
  }
}

function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null
  const idx = Math.floor(sortedValues.length * p)
  return sortedValues[Math.min(idx, sortedValues.length - 1)]
}

export function buildRateLimit(
  requestsPerMinute: number | null,
  tokensPerMinute: number | null,
  resetWindow: RateLimit["resetWindow"],
): RateLimit {
  return { requestsPerMinute, tokensPerMinute, resetWindow }
}