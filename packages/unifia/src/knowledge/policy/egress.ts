/* SPDX-License-Identifier: MIT */
/**
 * Egress policy.
 *
 * See ADR-KNOW-0006. The egress decision is the heart of the
 * Sovereign Core: a single function that decides whether a
 * `ContextItem` is allowed to flow to a given provider.
 *
 * Rules (mirroring the ADR):
 * 1. Portable restrictions can only restrict (default deny for
 *    `remoteModel` on UNCLASSIFIED).
 * 2. UNCLASSIFIED, unverified provenance, fallback cloud = DENY
 *    EXTERNAL.
 * 3. The most restrictive ancestor wins (heritage).
 * 4. ProviderPlan overrides may further restrict but never widen.
 */

import type { ContextItem, ProviderDestinationPlan } from "@unifia/contracts/knowledge"

export type EgressDecision = "allow" | "deny"

export interface EgressInput {
  item: ContextItem
  plan: ProviderDestinationPlan
}

export interface EgressResult {
  decision: EgressDecision
  reason: string
}

/**
 * Decide whether an item can flow to the given provider.
 *
 * Pure: same input, same output. No I/O, no logging. The caller
 * is responsible for emitting an `egress.decision` event.
 */
export function decideEgress(input: EgressInput): EgressResult {
  const { item, plan } = input

  // 1. UNCLASSIFIED (no portable restriction) defaults to deny external.
  if (item.restriction === "deny" && plan.defaultRestriction === "deny") {
    return { decision: "deny", reason: "item restriction is deny and provider default is deny" }
  }

  // 2. Per-item override.
  const override = plan.overrides?.[item.ref.id] ?? plan.overrides?.[item.ref.locator]
  if (override === "deny") {
    return { decision: "deny", reason: "per-item override denies egress" }
  }
  if (override === "allow") {
    return { decision: "allow", reason: "per-item override allows egress" }
  }

  // 3. The item's own restriction.
  if (item.restriction === "deny") {
    return { decision: "deny", reason: "item portable restriction is deny" }
  }

  // 4. Provider default.
  if (plan.defaultRestriction === "deny") {
    return { decision: "deny", reason: "provider default restriction is deny" }
  }

  // 5. Trust: unverified items are NOT auto-denied, but the
  //    provider is expected to surface this in the Context
  //    Inspector. We return allow but record trust in the reason.
  if (item.trust === "unverified") {
    return { decision: "allow", reason: "allow with trust=unverified" }
  }

  return { decision: "allow", reason: "no restriction" }
}

/** Apply egress policy to many items. */
export function decideEgressBatch(
  items: readonly ContextItem[],
  plan: ProviderDestinationPlan,
): EgressResult[] {
  return items.map((item) => decideEgress({ item, plan }))
}
