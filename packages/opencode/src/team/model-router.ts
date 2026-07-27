import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { endpointKey } from "./candidate-generator"

// =============================================================================
// model-router.ts — TEAM-F03
//
// The always-available routing path: given the candidates that survived
// F01's hard filters and F02's Pareto reduction, pick a primary endpoint,
// an independent reviewer and a fallback under a named, versioned policy —
// Economy, Balanced, Quality or Custom.
//
// This is rules-based on purpose. It makes no LLM call, consults no live
// service, and reads no clock: it is the deterministic path that must keep
// working when the learned estimators are unavailable. Everything it needs
// is supplied by the caller, so a decision can be replayed exactly from its
// snapshot.
//
// Two properties drive most of the design:
//
//   No silent degradation. When no candidate clears the policy's success
//   and budget thresholds, the router does NOT quietly return the least-bad
//   option. It returns a blocked decision naming what failed. Silently
//   downgrading is how a routing layer ends up shipping work to a model
//   that was never good enough for it.
//
//   No unearned premium. A more expensive candidate replaces a cheaper,
//   already-adequate one only if it buys at least `minSuccessGainForUpgrade`
//   additional probability of success. The threshold is what distinguishes
//   the policies: Economy sets it above 1 (unreachable, so it always keeps
//   the cheapest adequate option), Quality sets it low, Balanced sits
//   between. Paying more is a decision that has to be justified by a number,
//   not by a policy's name.
// =============================================================================

export const ROUTING_SNAPSHOT_VERSION = "1.0.0" as const
export const ROUTING_POLICY_VERSION = "1.0.0" as const

// -----------------------------------------------------------------------
// Boundary validation
// -----------------------------------------------------------------------

export const ModelRouterInputError = NamedError.create(
  "ModelRouterInputError",
  z.object({
    entity: z.string(),
    issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })),
  }),
)

function parseBoundary<Schema extends z.ZodTypeAny>(schema: Schema, entity: string, raw: unknown): z.infer<Schema> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new ModelRouterInputError({
      entity,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    })
  }
  return result.data
}

// -----------------------------------------------------------------------
// Candidates
// -----------------------------------------------------------------------

/**
 * Where a quality signal came from. Persisted with the decision because
 * "this model scores 0.9" means something very different when measured on
 * a benchmark than when it is a family default with no evidence behind it.
 */
export const QualitySourceSchema = z.enum(["benchmark", "observed_history", "family_prior", "default"])
export type QualitySource = z.infer<typeof QualitySourceSchema>

export const RoutingCandidateSchema = z
  .object({
    providerID: z.string().min(1),
    modelID: z.string().min(1),
    releaseKey: z.string().min(1),
    family: z.string().min(1).nullable(),
    costPerMillionInputTokens: z.number().nonnegative(),
    costPerMillionOutputTokens: z.number().nonnegative(),
    contextTotalTokens: z.number().int().positive(),
    availabilityScore: z.number().min(0).max(1),
    /** Probability this endpoint produces an acceptable result in one attempt. */
    perAttemptSuccessProbability: z.number().min(0).max(1),
    qualitySource: QualitySourceSchema,
    /** How much to trust `perAttemptSuccessProbability` itself. */
    qualityConfidence: z.number().min(0).max(1),
  })
  .strict()
export type RoutingCandidate = Readonly<z.infer<typeof RoutingCandidateSchema>>

export const RoutingCandidateListSchema = z.array(RoutingCandidateSchema).superRefine((list, ctx) => {
  const seen = new Set<string>()
  list.forEach((candidate, index) => {
    const key = endpointKey(candidate)
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index], message: `duplicate candidate ${key}` })
    seen.add(key)
  })
})

// -----------------------------------------------------------------------
// Task profile
// -----------------------------------------------------------------------

export const TaskProfileSchema = z
  .object({
    expectedInputTokens: z.number().int().nonnegative(),
    expectedOutputTokens: z.number().int().nonnegative(),
    /** Hard cap on attempts before the primary is abandoned for the fallback. */
    maxAttempts: z.number().int().positive().max(10),
    /** Cost of one repair cycle, as a fraction of one attempt's cost. */
    repairCostFactor: z.number().min(0).max(5),
    requiresIndependentReviewer: z.boolean(),
    /** Minimum context the task needs; candidates below it are rejected. */
    requiredContextTokens: z.number().int().positive(),
  })
  .strict()
export type TaskProfile = z.input<typeof TaskProfileSchema>
type ResolvedTaskProfile = z.output<typeof TaskProfileSchema>

// -----------------------------------------------------------------------
// Policies — versioned rules
// -----------------------------------------------------------------------

export const RoutingPolicyNameSchema = z.enum(["economy", "balanced", "quality", "custom"])
export type RoutingPolicyName = z.infer<typeof RoutingPolicyNameSchema>

export const RoutingPolicySchema = z
  .object({
    name: RoutingPolicyNameSchema,
    version: z.string().min(1),
    /** Overall success probability the chosen endpoint must reach. */
    minSuccessProbability: z.number().min(0).max(1),
    /** Expected-cost ceiling in USD; `null` = no ceiling. */
    maxExpectedCostUsd: z.number().nonnegative().nullable(),
    /**
     * Extra success probability a pricier candidate must deliver before it
     * may displace a cheaper adequate one. Values > 1 are unreachable by
     * construction and mean "never upgrade on price".
     */
    minSuccessGainForUpgrade: z.number().min(0).max(2),
    /** Minimum availability for the endpoint to be considered at all. */
    minAvailabilityScore: z.number().min(0).max(1),
    /** Minimum per-attempt success a reviewer endpoint must have. */
    minReviewerSuccessProbability: z.number().min(0).max(1),
  })
  .strict()
export type RoutingPolicy = Readonly<z.infer<typeof RoutingPolicySchema>>

/**
 * The built-in policies. Frozen and versioned: a decision snapshot records
 * `policyVersion`, so a replay can tell whether it is comparing against the
 * same rules that produced the original decision.
 */
export const BUILTIN_ROUTING_POLICIES: Readonly<Record<"economy" | "balanced" | "quality", RoutingPolicy>> =
  Object.freeze({
    economy: Object.freeze({
      name: "economy" as const,
      version: ROUTING_POLICY_VERSION,
      minSuccessProbability: 0.6,
      maxExpectedCostUsd: null,
      // Unreachable by construction: probabilities live in [0,1], so no
      // candidate can ever gain more than 1. Economy therefore always keeps
      // the cheapest endpoint that clears the thresholds.
      minSuccessGainForUpgrade: 1.01,
      minAvailabilityScore: 0.8,
      minReviewerSuccessProbability: 0.5,
    }),
    balanced: Object.freeze({
      name: "balanced" as const,
      version: ROUTING_POLICY_VERSION,
      minSuccessProbability: 0.75,
      maxExpectedCostUsd: null,
      minSuccessGainForUpgrade: 0.1,
      minAvailabilityScore: 0.9,
      minReviewerSuccessProbability: 0.6,
    }),
    quality: Object.freeze({
      name: "quality" as const,
      version: ROUTING_POLICY_VERSION,
      minSuccessProbability: 0.9,
      maxExpectedCostUsd: null,
      minSuccessGainForUpgrade: 0.02,
      minAvailabilityScore: 0.95,
      minReviewerSuccessProbability: 0.8,
    }),
  })

/** Build a validated custom policy. Always named "custom". */
export function customRoutingPolicy(overrides: Omit<z.input<typeof RoutingPolicySchema>, "name" | "version">): RoutingPolicy {
  return Object.freeze(
    parseBoundary(RoutingPolicySchema, "policy", { ...overrides, name: "custom", version: ROUTING_POLICY_VERSION }),
  )
}

// -----------------------------------------------------------------------
// Expected cost model
// -----------------------------------------------------------------------

export interface ExpectedCostBreakdown {
  readonly attemptCostUsd: number
  readonly expectedAttempts: number
  readonly implementationCostUsd: number
  readonly repairCostUsd: number
  readonly reviewCostUsd: number
  readonly fallbackCostUsd: number
  readonly totalCostUsd: number
  readonly successProbability: number
}

function attemptCostUsd(candidate: RoutingCandidate, task: ResolvedTaskProfile): number {
  return (
    (task.expectedInputTokens / 1_000_000) * candidate.costPerMillionInputTokens +
    (task.expectedOutputTokens / 1_000_000) * candidate.costPerMillionOutputTokens
  )
}

/**
 * Expected number of attempts under a cap, for a per-attempt success
 * probability `p`: sum of the probabilities of still being in play before
 * each attempt, i.e. Σ_{k=0}^{n-1} (1-p)^k. With p = 0 every attempt is
 * spent, giving exactly `n`.
 */
function expectedAttempts(p: number, maxAttempts: number): number {
  if (p <= 0) return maxAttempts
  return (1 - (1 - p) ** maxAttempts) / p
}

/**
 * Full expected cost of driving this candidate to a validated result:
 * implementation attempts, the repair cycles that follow each failure, the
 * review of each produced attempt, and the fallback that has to run if the
 * primary exhausts its attempts. Costing only the first attempt is what
 * makes a cheap-but-unreliable endpoint look artificially attractive.
 */
export function estimateExpectedCost(
  candidate: RoutingCandidate,
  task: ResolvedTaskProfile,
  reviewer: RoutingCandidate | null,
  fallbackAttemptCostUsd: number,
): ExpectedCostBreakdown {
  const perAttempt = attemptCostUsd(candidate, task)
  const attempts = expectedAttempts(candidate.perAttemptSuccessProbability, task.maxAttempts)
  const failureProbability = (1 - candidate.perAttemptSuccessProbability) ** task.maxAttempts

  const implementationCostUsd = attempts * perAttempt
  // Every attempt but the last successful one is followed by a repair cycle.
  const repairCostUsd = Math.max(0, attempts - 1) * perAttempt * task.repairCostFactor
  const reviewCostUsd = reviewer === null ? 0 : attempts * attemptCostUsd(reviewer, task)
  const fallbackCostUsd = failureProbability * fallbackAttemptCostUsd

  return {
    attemptCostUsd: perAttempt,
    expectedAttempts: attempts,
    implementationCostUsd,
    repairCostUsd,
    reviewCostUsd,
    fallbackCostUsd,
    totalCostUsd: implementationCostUsd + repairCostUsd + reviewCostUsd + fallbackCostUsd,
    successProbability: 1 - failureProbability,
  }
}

// -----------------------------------------------------------------------
// Eliminations
// -----------------------------------------------------------------------

export const RoutingRejectionSchema = z.enum([
  "CONTEXT_TOO_SMALL",
  "BELOW_MIN_AVAILABILITY",
  "BELOW_MIN_SUCCESS_PROBABILITY",
  "OVER_EXPECTED_BUDGET",
  "NOT_SELECTED_NO_REQUIRED_GAIN",
  "NOT_SELECTED_COSTLIER_EQUAL_QUALITY",
])
export type RoutingRejection = z.infer<typeof RoutingRejectionSchema>

export interface EliminatedRoutingCandidate {
  readonly endpointKey: string
  readonly providerID: string
  readonly modelID: string
  readonly family: string | null
  readonly rejection: RoutingRejection
  readonly reason: string
}

// -----------------------------------------------------------------------
// Decision snapshot
// -----------------------------------------------------------------------

export interface RoutingSelection {
  readonly endpointKey: string
  readonly providerID: string
  readonly modelID: string
  readonly family: string | null
  readonly cost: ExpectedCostBreakdown
  readonly qualitySource: QualitySource
  readonly qualityConfidence: number
}

export interface RoutingDecisionSnapshot {
  readonly snapshotVersion: typeof ROUTING_SNAPSHOT_VERSION
  readonly policyName: RoutingPolicyName
  readonly policyVersion: string
  /** Every candidate key considered, sorted — the replay contract. */
  readonly consideredEndpointKeys: readonly string[]
  readonly selected: RoutingSelection | null
  readonly reviewerEndpointKey: string | null
  readonly fallbackEndpointKey: string | null
  readonly eliminated: readonly EliminatedRoutingCandidate[]
  /** Provenance of the quality signals behind this decision. */
  readonly qualitySources: Readonly<Partial<Record<QualitySource, number>>>
  /** Confidence in the decision, capped by its weakest load-bearing signal. */
  readonly confidence: number
  readonly confidenceFactors: readonly string[]
  readonly blocked: boolean
  readonly blockingReasons: readonly string[]
  /** Stable hash of policy + task + candidate signals. Same in, same out. */
  readonly reproducibilityKey: string
}

export interface RouteModelInput {
  readonly candidates: readonly RoutingCandidate[]
  readonly task: TaskProfile
  readonly policy: RoutingPolicy
}

function reject(
  candidate: RoutingCandidate,
  rejection: RoutingRejection,
  reason: string,
): EliminatedRoutingCandidate {
  return {
    endpointKey: endpointKey(candidate),
    providerID: candidate.providerID,
    modelID: candidate.modelID,
    family: candidate.family,
    rejection,
    reason,
  }
}

function buildReproducibilityKey(
  candidates: readonly RoutingCandidate[],
  task: ResolvedTaskProfile,
  policy: RoutingPolicy,
): string {
  const canonicalCandidates = [...candidates]
    .map((candidate) => ({
      key: endpointKey(candidate),
      cost: [candidate.costPerMillionInputTokens, candidate.costPerMillionOutputTokens],
      context: candidate.contextTotalTokens,
      availability: candidate.availabilityScore,
      success: candidate.perAttemptSuccessProbability,
      source: candidate.qualitySource,
      confidence: candidate.qualityConfidence,
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(
    JSON.stringify({
      snapshotVersion: ROUTING_SNAPSHOT_VERSION,
      policy,
      task,
      candidates: canonicalCandidates,
    }),
  )
  return hasher.digest("hex")
}

/**
 * Pick the cheapest endpoint that clears the policy, upgrading only when a
 * pricier candidate buys at least `minSuccessGainForUpgrade` more success.
 *
 * Ties on cost are broken by success probability, then by endpointKey, so
 * the winner never depends on input order.
 */
function selectPrimary(
  affordable: readonly { candidate: RoutingCandidate; cost: ExpectedCostBreakdown }[],
  policy: RoutingPolicy,
): { chosen: { candidate: RoutingCandidate; cost: ExpectedCostBreakdown }; eliminated: EliminatedRoutingCandidate[] } {
  const ordered = [...affordable].sort(
    (a, b) =>
      a.cost.totalCostUsd - b.cost.totalCostUsd ||
      b.cost.successProbability - a.cost.successProbability ||
      endpointKey(a.candidate).localeCompare(endpointKey(b.candidate)),
  )

  let incumbent = ordered[0]!
  const eliminated: EliminatedRoutingCandidate[] = []

  for (const challenger of ordered.slice(1)) {
    const gain = challenger.cost.successProbability - incumbent.cost.successProbability
    if (gain >= policy.minSuccessGainForUpgrade) {
      eliminated.push(
        reject(
          incumbent.candidate,
          "NOT_SELECTED_NO_REQUIRED_GAIN",
          `superseded by ${endpointKey(challenger.candidate)}, which adds ${gain.toFixed(4)} success probability (policy requires ${policy.minSuccessGainForUpgrade})`,
        ),
      )
      incumbent = challenger
      continue
    }
    eliminated.push(
      gain > 0
        ? reject(
            challenger.candidate,
            "NOT_SELECTED_NO_REQUIRED_GAIN",
            `costs ${(challenger.cost.totalCostUsd - incumbent.cost.totalCostUsd).toFixed(6)} USD more than ${endpointKey(incumbent.candidate)} for only ${gain.toFixed(4)} extra success probability (policy requires ${policy.minSuccessGainForUpgrade})`,
          )
        : reject(
            challenger.candidate,
            "NOT_SELECTED_COSTLIER_EQUAL_QUALITY",
            `costlier than ${endpointKey(incumbent.candidate)} without being more likely to succeed`,
          ),
    )
  }

  return { chosen: incumbent, eliminated }
}

/**
 * Route a task to a primary endpoint, an independent reviewer and a
 * fallback under `policy`.
 *
 * Pure and clock-free: no LLM, network, provider, git or filesystem call,
 * and no timestamp. The caller stamps the snapshot when persisting it —
 * embedding a clock reading here would make an otherwise reproducible
 * decision differ on every run.
 *
 * Returns a blocked snapshot rather than a degraded selection when nothing
 * clears the policy.
 */
export function routeModel(input: RouteModelInput): RoutingDecisionSnapshot {
  const candidates: RoutingCandidate[] = parseBoundary(RoutingCandidateListSchema, "candidates", input.candidates)
  const task = parseBoundary(TaskProfileSchema, "task", input.task)
  const policy = parseBoundary(RoutingPolicySchema, "policy", input.policy)
  const frozen = candidates.map((candidate) => Object.freeze(candidate))

  const eliminated: EliminatedRoutingCandidate[] = []

  // 1. Hard admissibility, independent of cost.
  const admissible = frozen.filter((candidate) => {
    if (candidate.contextTotalTokens < task.requiredContextTokens) {
      eliminated.push(
        reject(
          candidate,
          "CONTEXT_TOO_SMALL",
          `context ${candidate.contextTotalTokens} < required ${task.requiredContextTokens}`,
        ),
      )
      return false
    }
    if (candidate.availabilityScore < policy.minAvailabilityScore) {
      eliminated.push(
        reject(
          candidate,
          "BELOW_MIN_AVAILABILITY",
          `availability ${candidate.availabilityScore} < policy minimum ${policy.minAvailabilityScore}`,
        ),
      )
      return false
    }
    return true
  })

  // 2. Reviewer is chosen before costing, because reviewing is part of the
  //    cost of reaching a validated result.
  const reviewerPool = admissible.filter(
    (candidate) => candidate.perAttemptSuccessProbability >= policy.minReviewerSuccessProbability,
  )

  // 3. Cost every admissible candidate, pairing it with the cheapest
  //    independent reviewer available to it.
  const costed = admissible.map((candidate) => {
    const reviewer = task.requiresIndependentReviewer ? pickReviewer(candidate, reviewerPool, task) : null
    const fallbackAttempt = cheapestOtherProviderAttemptCost(candidate, admissible, task)
    return { candidate, reviewer, cost: estimateExpectedCost(candidate, task, reviewer, fallbackAttempt) }
  })

  // 4. Policy thresholds — rejections here are explicit, never a downgrade.
  const affordable = costed.filter((entry) => {
    if (entry.cost.successProbability < policy.minSuccessProbability) {
      eliminated.push(
        reject(
          entry.candidate,
          "BELOW_MIN_SUCCESS_PROBABILITY",
          `success probability ${entry.cost.successProbability.toFixed(4)} over ${task.maxAttempts} attempt(s) < policy minimum ${policy.minSuccessProbability}`,
        ),
      )
      return false
    }
    if (policy.maxExpectedCostUsd !== null && entry.cost.totalCostUsd > policy.maxExpectedCostUsd) {
      eliminated.push(
        reject(
          entry.candidate,
          "OVER_EXPECTED_BUDGET",
          `expected cost ${entry.cost.totalCostUsd.toFixed(6)} USD > policy ceiling ${policy.maxExpectedCostUsd}`,
        ),
      )
      return false
    }
    return true
  })

  const consideredEndpointKeys = frozen.map(endpointKey).sort()
  const reproducibilityKey = buildReproducibilityKey(frozen, task, policy)
  const qualitySources: Partial<Record<QualitySource, number>> = {}
  for (const candidate of frozen) {
    qualitySources[candidate.qualitySource] = (qualitySources[candidate.qualitySource] ?? 0) + 1
  }

  const blockingReasons: string[] = []
  if (frozen.length === 0) blockingReasons.push("no candidate supplied")
  else if (admissible.length === 0) blockingReasons.push("no candidate met the context and availability requirements")
  else if (affordable.length === 0) {
    blockingReasons.push(
      `no candidate reached the policy's minimum success probability (${policy.minSuccessProbability})${policy.maxExpectedCostUsd === null ? "" : ` within its cost ceiling (${policy.maxExpectedCostUsd} USD)`}`,
    )
  }

  if (blockingReasons.length > 0) {
    return {
      snapshotVersion: ROUTING_SNAPSHOT_VERSION,
      policyName: policy.name,
      policyVersion: policy.version,
      consideredEndpointKeys,
      selected: null,
      reviewerEndpointKey: null,
      fallbackEndpointKey: null,
      eliminated,
      qualitySources,
      confidence: 0,
      confidenceFactors: ["no selection was made"],
      blocked: true,
      blockingReasons,
      reproducibilityKey,
    }
  }

  const { chosen, eliminated: notSelected } = selectPrimary(
    affordable.map((entry) => ({ candidate: entry.candidate, cost: entry.cost })),
    policy,
  )
  eliminated.push(...notSelected)

  const chosenEntry = costed.find((entry) => entry.candidate === chosen.candidate)!
  const reviewer = chosenEntry.reviewer
  const fallback = pickFallback(chosen.candidate, affordable, policy)

  if (task.requiresIndependentReviewer && reviewer === null) {
    blockingReasons.push(
      `task requires an independent reviewer but no candidate of a different family reached the policy's reviewer minimum (${policy.minReviewerSuccessProbability})`,
    )
    return {
      snapshotVersion: ROUTING_SNAPSHOT_VERSION,
      policyName: policy.name,
      policyVersion: policy.version,
      consideredEndpointKeys,
      selected: null,
      reviewerEndpointKey: null,
      fallbackEndpointKey: null,
      eliminated,
      qualitySources,
      confidence: 0,
      confidenceFactors: ["no independent reviewer available"],
      blocked: true,
      blockingReasons,
      reproducibilityKey,
    }
  }

  const confidenceFactors: string[] = [
    `primary quality signal from ${chosen.candidate.qualitySource} (confidence ${chosen.candidate.qualityConfidence})`,
  ]
  let confidence = chosen.candidate.qualityConfidence
  if (fallback === null) {
    confidenceFactors.push("no fallback endpoint from a different provider is available")
    confidence = Math.min(confidence, 0.8)
  }
  if (reviewer !== null && reviewer.qualityConfidence < confidence) {
    confidenceFactors.push(`reviewer signal is weaker (confidence ${reviewer.qualityConfidence})`)
    confidence = reviewer.qualityConfidence
  }

  return {
    snapshotVersion: ROUTING_SNAPSHOT_VERSION,
    policyName: policy.name,
    policyVersion: policy.version,
    consideredEndpointKeys,
    selected: {
      endpointKey: endpointKey(chosen.candidate),
      providerID: chosen.candidate.providerID,
      modelID: chosen.candidate.modelID,
      family: chosen.candidate.family,
      cost: chosen.cost,
      qualitySource: chosen.candidate.qualitySource,
      qualityConfidence: chosen.candidate.qualityConfidence,
    },
    reviewerEndpointKey: reviewer === null ? null : endpointKey(reviewer),
    fallbackEndpointKey: fallback === null ? null : endpointKey(fallback),
    eliminated,
    qualitySources,
    confidence,
    confidenceFactors,
    blocked: false,
    blockingReasons: [],
    reproducibilityKey,
  }
}

/**
 * Cheapest reviewer from a different model family than `primary`.
 *
 * Family, not just endpoint: a same-family reviewer shares the
 * implementer's blind spots and is not meaningfully independent (D-010 §6,
 * the same rule F01 enforces on its reviewer-separation filter). A
 * `null` family cannot be proven independent, so it is never used as one.
 */
function pickReviewer(
  primary: RoutingCandidate,
  pool: readonly RoutingCandidate[],
  task: ResolvedTaskProfile,
): RoutingCandidate | null {
  const independent = pool.filter(
    (candidate) =>
      endpointKey(candidate) !== endpointKey(primary) &&
      candidate.family !== null &&
      primary.family !== null &&
      candidate.family !== primary.family,
  )
  return (
    [...independent].sort(
      (a, b) =>
        attemptCostUsd(a, task) - attemptCostUsd(b, task) || endpointKey(a).localeCompare(endpointKey(b)),
    )[0] ?? null
  )
}

/**
 * Best remaining candidate hosted by a different provider than the primary.
 * A same-provider fallback would share the outage it is meant to survive.
 */
function pickFallback(
  primary: RoutingCandidate,
  affordable: readonly { candidate: RoutingCandidate; cost: ExpectedCostBreakdown }[],
  _policy: RoutingPolicy,
): RoutingCandidate | null {
  const alternatives = affordable
    .filter((entry) => entry.candidate.providerID !== primary.providerID)
    .sort(
      (a, b) =>
        b.cost.successProbability - a.cost.successProbability ||
        a.cost.totalCostUsd - b.cost.totalCostUsd ||
        endpointKey(a.candidate).localeCompare(endpointKey(b.candidate)),
    )
  return alternatives[0]?.candidate ?? null
}

/**
 * Attempt cost of the cheapest endpoint on another provider, used as the
 * price of the fallback leg. Zero when the primary is the only provider —
 * there is nothing to fall back to, and `pickFallback` records that
 * separately by returning null.
 */
function cheapestOtherProviderAttemptCost(
  primary: RoutingCandidate,
  admissible: readonly RoutingCandidate[],
  task: ResolvedTaskProfile,
): number {
  const others = admissible
    .filter((candidate) => candidate.providerID !== primary.providerID)
    .map((candidate) => attemptCostUsd(candidate, task))
  return others.length === 0 ? 0 : Math.min(...others)
}
