/* SPDX-License-Identifier: MIT */
/**
 * Egress audit trail (ADR-KNOW-0006 §6, R-0012).
 *
 * The ADR requires that *every* egress decision — allow and deny alike —
 * produce an `egress.decision` record carrying the content hash, the
 * destination, the decision, the guard version and a timestamp. The event
 * kind existed on the domain bus and nothing ever emitted it, so the
 * invariant "every egress is traced" was declared and not held.
 *
 * `decideEgress` stays pure on purpose: a decision function that logs is a
 * decision function that cannot be tested without a sink. Emission is the
 * caller's job, and this module is what the callers use so they cannot each
 * invent a different record shape.
 */

import { randomUUID } from "node:crypto"
import type { ContextItem, ProviderDestinationPlan } from "@unifia/contracts/knowledge"
import type { DomainBus, DomainEvent } from "../events/bus.js"
import type { EgressResult } from "./egress.js"

/**
 * Version of the guard that produced a decision.
 *
 * Recorded with every entry so a trail read months later says which rules
 * were in force. Bump it whenever `decideEgress` changes its semantics.
 */
export const EGRESS_GUARD_VERSION = "v1.1"

export interface EgressAuditEntry {
  /** Content hash of what was considered. */
  hash: string
  /** Where it was headed: provider id, qualified by local/remote. */
  destination: string
  decision: "allow" | "deny"
  reason: string
  guardVersion: string
  timestamp: string
}

export interface EgressAudit {
  record(entry: EgressAuditEntry): void
}

/** Build the entry for one decision. Pure, so it is testable on its own. */
export function egressAuditEntry(
  item: ContextItem,
  plan: ProviderDestinationPlan,
  result: EgressResult,
): EgressAuditEntry {
  return {
    hash: item.contentHash,
    destination:
      plan.destinationKind === "local"
        ? `provider:${plan.providerId}`
        : `provider:${plan.providerId}:remote`,
    decision: result.decision,
    reason: result.reason,
    guardVersion: EGRESS_GUARD_VERSION,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Audit sink that emits onto the domain bus and keeps the entries.
 *
 * V1 has no persisted Class C control log, so the trail lives for the
 * lifetime of the composition. `entries()` is what a verification command
 * reads; persisting it is the remaining half of ADR-KNOW-0006 §6.
 */
export class InMemoryEgressAudit implements EgressAudit {
  private readonly log: EgressAuditEntry[] = []

  constructor(private readonly bus?: DomainBus) {}

  record(entry: EgressAuditEntry): void {
    this.log.push(entry)
    if (this.bus === undefined) return
    const event: DomainEvent = {
      id: randomUUID(),
      kind: "egress.decision",
      timestamp: entry.timestamp,
      payload: {
        hash: entry.hash,
        destination: entry.destination,
        decision: entry.decision,
        reason: entry.reason,
        guardVersion: entry.guardVersion,
      },
    }
    this.bus.emit(event)
  }

  /** Every decision recorded so far, oldest first. */
  entries(): readonly EgressAuditEntry[] {
    return this.log
  }

  /** How many decisions went each way — for `verify` and the inspector. */
  tally(): { allow: number; deny: number } {
    let allow = 0
    let deny = 0
    for (const e of this.log) {
      if (e.decision === "allow") allow += 1
      else deny += 1
    }
    return { allow, deny }
  }
}
