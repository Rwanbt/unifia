/* SPDX-License-Identifier: MIT */
/** C8/C9 runtime services. State is instance-owned and exposed only through copies. */

export type RuntimeDecision = "allow" | "deny" | "approval_required"
export type AuditEvent = {
  sequence: number
  timestamp: number
  actor: string
  capability: string
  decision: RuntimeDecision
  previousHash: string
  hash: string
}

export class AuditRuntimeDouble {
  private readonly entries: AuditEvent[] = []
  public constructor(private readonly now: () => number = () => Date.now()) {}

  public record(actor: string, capability: string, decision: RuntimeDecision): AuditEvent {
    const previousHash = this.entries.at(-1)?.hash ?? "GENESIS"
    const sequence = this.entries.length + 1
    const hash = `${sequence}:${previousHash}:${actor}:${capability}:${decision}`
    const event = { sequence, timestamp: this.now(), actor, capability, decision, previousHash, hash }
    this.entries.push(event)
    return event
  }

  public events(): readonly AuditEvent[] { return this.entries.map((event) => ({ ...event })) }
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
