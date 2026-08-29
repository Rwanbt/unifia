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
 *
 * V1 scope, honestly stated:
 * - Rules 1, 2 and 4 are enforced by `decideEgress` below.
 * - Rule 3 (heritage across summaries/translations/embeddings) is NOT
 *   implemented; there is no transformation lineage to inherit from yet.
 * - `DeclassificationGrant` (ADR-KNOW-0006 §3) is NOT implemented, so no
 *   caller can legitimately widen a deny in V1.
 * - Callers must still emit the `egress.decision` audit event (§6); this
 *   function stays pure.
 * See R-0012 for the tracking of the unimplemented parts.
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
  const override = plan.overrides?.[item.ref.id] ?? plan.overrides?.[item.ref.locator]

  // Every deny is evaluated before any allow. A portable restriction can only
  // ever be relaxed by an audited DeclassificationGrant (ADR-KNOW-0006 §3),
  // which V1 does not implement — so in V1 nothing widens a deny.

  // 1. The item's own portable restriction. Ordering matters: this must be
  //    decided BEFORE any `allow` override, otherwise a plan override widens
  //    a note that asked never to leave (ADR-KNOW-0006 §1, §4).
  if (item.restriction === "deny") {
    return { decision: "deny", reason: "item portable restriction is deny" }
  }

  // 2. A per-item override may restrict.
  if (override === "deny") {
    return { decision: "deny", reason: "per-item override denies egress" }
  }

  // 3. Provider default.
  if (plan.defaultRestriction === "deny") {
    return { decision: "deny", reason: "provider default restriction is deny" }
  }

  // 4. Unresolved provenance is treated as UNCLASSIFIED and denied
  //    (ADR-KNOW-0006 §2). V1's ProviderDestinationPlan carries no
  //    local/remote discriminator, so the fail-closed reading applies to every
  //    destination; relaxing this for a local provider needs that
  //    discriminator first.
  if (item.trust === "unverified") {
    return { decision: "deny", reason: "provenance is unverified (ADR-KNOW-0006 §2)" }
  }

  // 5. An `allow` override is a confirmation, never a widening: it is only
  //    reachable once every deny above has been cleared.
  if (override === "allow") {
    return { decision: "allow", reason: "per-item override confirms egress" }
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
