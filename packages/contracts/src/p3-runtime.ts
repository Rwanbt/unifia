/* SPDX-License-Identifier: MIT */
/** C8/C9 runtime services. State is instance-owned and exposed only through copies. */

import type { P3Capability } from "./p3.js"

export type RuntimeDecision = "allow" | "deny" | "approval_required"
/**
 * DA-AUD-01/02/03 — every audit row now carries the full attribution
 * (Plan-Critique 4.0 §3.3 A3–A6, B07 §4). `actor` is the identity
 * string (principal.id, or "system:<context>" for server-driven rows);
 * `actorKind` discriminates the two so a downstream reader can group
 * user-driven from system-driven decisions without parsing the identity.
 * `action` is the route label (e.g. "workflow.start"), `authorizingCapability`
 * is the P3 capability the gate was asked about (e.g. "workflow.run"),
 * `resource` is the workspace id (or null), `reason` is the broker's
 * `P3Decision.ruleId` (e.g. "C2-unknown-capability"). Pre-auth rows
 * (handshake, anonymous rejection, shutdown) carry actorKind="system"
 * and principalId=null.
 */
export type AuditActorKind = "system" | "user"
export type AuditEvent = {
  sequence: number
  timestamp: number
  /** Legacy identity slot — kept for backward-compat with existing readers. */
  actor: string
  /** "system" (server-driven) or "user" (post-auth, principal-scoped). */
  actorKind: AuditActorKind
  /** principal.id for user actions; null for system actions. */
  principalId: string | null
  /** Route label (e.g. "workflow.start", "artifact.create", "handshake.accept"). */
  action: string
  /** Legacy capability slot — same string as `authorizingCapability` when set, else the action. */
  capability: string
  /** P3 capability the broker was asked about, or null if not capability-gated. */
  authorizingCapability: P3Capability | null
  /** Resource id (typically the workspace id), or null if not applicable. */
  resource: string | null
  /** Broker ruleId or failure reason, or null. */
  reason: string | null
  decision: RuntimeDecision
  previousHash: string
  hash: string
}

/**
 * Carries the full attribution for one audit row. Used by the canonical
 * `record(context, decision)` overload; the legacy 3-arg form fills in
 * actorKind="system", principalId=null, action=capability,
 * authorizingCapability=null, resource=null, reason=null.
 */
export type AuditContext = {
  actor: string
  actorKind: AuditActorKind
  principalId: string | null
  action: string
  capability: string
  authorizingCapability: P3Capability | null
  resource: string | null
  reason: string | null
}

export class AuditRuntimeDouble {
  private readonly entries: AuditEvent[] = []
  public constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Legacy 3-arg overload (kept so p3-runtime-smoke.ts and any other
   * contract-level test that doesn't care about attribution still
   * works). Writes a system actor with no principal / no reason / no
   * resource, with the actor string copied into the `actor` slot and
   * the capability copied into the `action` slot. The hash includes
   * the new fields too — the chain evolved, so the hash of a legacy
   * row does NOT match the hash of the same logical event written by
   * the new overload. See AuditMigration note in
   * `integration/da-aud.md` for the on-disk implication.
   */
  public record(actor: string, capability: string, decision: RuntimeDecision): AuditEvent
  public record(context: AuditContext, decision: RuntimeDecision): AuditEvent
  public record(a: string | AuditContext, capabilityOrDecision: string | RuntimeDecision, decision?: RuntimeDecision): AuditEvent {
    const context: AuditContext = typeof a === "string"
      ? { actor: a, actorKind: "system", principalId: null, action: capabilityOrDecision as string, capability: capabilityOrDecision as string, authorizingCapability: null, resource: null, reason: null }
      : a
    const actualDecision = (typeof a === "string" ? decision : capabilityOrDecision) as RuntimeDecision
    return this.#write(context, actualDecision)
  }

  #write(context: AuditContext, decision: RuntimeDecision): AuditEvent {
    const previousHash = this.entries.at(-1)?.hash ?? "GENESIS"
    const sequence = this.entries.length + 1
    const principalId = context.principalId ?? ""
    const resource = context.resource ?? ""
    const reason = context.reason ?? ""
    const authorizingCapability = context.authorizingCapability ?? ""
    // WHY all eight fields are concatenated into the hash: any change to any
    // attribute of an audit row must invalidate the chain. A row that
    // disagrees on the actor but agrees on the capability must NOT verify.
    const hash = `${sequence}:${previousHash}:${context.actorKind}:${principalId}:${context.actor}:${context.action}:${context.capability}:${authorizingCapability}:${resource}:${reason}:${decision}`
    const event: AuditEvent = {
      sequence,
      timestamp: this.now(),
      actor: context.actor,
      actorKind: context.actorKind,
      principalId: context.principalId,
      action: context.action,
      capability: context.capability,
      authorizingCapability: context.authorizingCapability,
      resource: context.resource,
      reason: context.reason,
      decision,
      previousHash,
      hash,
    }
    this.entries.push(event)
    return { ...event }
  }

  public events(): readonly AuditEvent[] { return this.entries.map((event) => ({ ...event })) }

  public page(afterSequence = 0, limit = 50): { events: readonly AuditEvent[]; nextCursor: number | null } {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
    const events = this.entries.filter((event) => event.sequence > afterSequence).slice(0, safeLimit).map((event) => ({ ...event }))
    const last = events.at(-1)?.sequence
    return { events, nextCursor: events.length === safeLimit && last !== undefined ? last : null }
  }
}

export type SecretHandle = { id: string; name: string; scope: string }
export class SecretStoreDouble {
  private readonly secrets = new Map<string, string>()
  private nextHandle = 1
  public put(name: string, value: string): void { this.secrets.set(name, value) }
  public read(name: string, scope: string): SecretHandle | undefined {
    if (!this.secrets.has(name)) return undefined
    return { id: `secret-handle-${this.nextHandle++}`, name, scope }
  }
  public resolve(handle: SecretHandle, scope: string): string | undefined {
    return handle.scope === scope ? this.secrets.get(handle.name) : undefined
  }
  public names(): readonly string[] { return [...this.secrets.keys()] }
}

export class QuotaDouble {
  private used = 0
  public constructor(private readonly limit: number) {}
  public consume(amount: number): boolean {
    if (amount < 0 || this.used + amount > this.limit) return false
    this.used += amount
    return true
  }
  public remaining(): number { return this.limit - this.used }
}

export type KillSwitchSurface = "all-remote" | "all-plugin-enable" | "global"
export class KillSwitchDouble {
  private readonly engaged = new Set<KillSwitchSurface>()
  public engage(surface: KillSwitchSurface): void { this.engaged.add(surface) }
  public isEngaged(surface: KillSwitchSurface): boolean { return this.engaged.has(surface) || this.engaged.has("global") }
}
export type SecretRecord = { name: string; value: string; expiresAt?: number }
export class SecretStore {
  private readonly secrets = new Map<string, SecretRecord>()
  private readonly handles = new Map<string, { name: string; scope: string; expiresAt: number }>()
  private nextHandle = 1
  public constructor(private readonly now: () => number = () => Date.now(), private readonly handleTtlMs = 30_000) {}
  public put(record: SecretRecord): void {
    if (!record.name || !record.value) throw new Error("secret name and value are required")
    this.secrets.set(record.name, { ...record })
  }
  public issue(name: string, scope: string): SecretHandle | undefined {
    const secret = this.secrets.get(name)
    if (!secret || secret.expiresAt !== undefined && secret.expiresAt <= this.now()) return undefined
    const id = `secret-handle-${this.nextHandle++}`
    this.handles.set(id, { name, scope, expiresAt: this.now() + this.handleTtlMs })
    return { id, name, scope }
  }
  public resolve(handle: SecretHandle, scope: string): string | undefined {
    const issued = this.handles.get(handle.id)
    if (!issued || issued.scope !== scope || issued.name !== handle.name || issued.expiresAt <= this.now()) return undefined
    const secret = this.secrets.get(issued.name)
    if (!secret || secret.expiresAt !== undefined && secret.expiresAt <= this.now()) return undefined
    return secret.value
  }
  public revoke(name: string): boolean { return this.secrets.delete(name) }
  public names(): readonly string[] { return [...this.secrets.keys()] }
}

export type KillSwitch = "all-remote" | "all-plugin-enable" | "global" | "browser" | "computer-use" | "document-packs" | "workflow-automation" | "marketplace"
export class KillSwitchRegistry {
  private readonly engaged = new Set<KillSwitch>()
  public engage(surface: KillSwitch): void { this.engaged.add(surface) }
  public release(surface: KillSwitch): void { this.engaged.delete(surface) }
  public isEngaged(surface: KillSwitch): boolean { return this.engaged.has(surface) || this.engaged.has("global") || surface === "all-remote" && this.engaged.has("global") }
  public snapshot(): readonly KillSwitch[] { return [...this.engaged] }
}
