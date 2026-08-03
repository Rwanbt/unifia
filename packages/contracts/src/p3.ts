/** P3 security foundation doubles. These are pure contract implementations used by conformance tests. */

export const P3_CAPABILITIES = [
  "workspace.read", "workspace.write", "workspace.watch", "artifact.create",
  "artifact.export", "terminal.run", "network.request", "browser.navigate",
  "desktop.observe", "desktop.control", "remote.receive", "remote.respond",
  "secret.read", "package.install",
] as const
export type P3Capability = (typeof P3_CAPABILITIES)[number]

export type P3Decision =
  | { kind: "allow"; ruleId: string }
  | { kind: "deny"; ruleId: string; reason: string }
  | { kind: "approval_required"; ruleId: string; approvalId: string }

export type ApprovalConfig = { mode: "allowlist" | "auto" | "manual" }
export function validateApprovalConfig(config: ApprovalConfig): void {
  if (config.mode === "auto") throw new Error("global auto approval is forbidden")
}

export type ApprovalRequest = {
  id: string
  capability: P3Capability
  resource: string
  expiresAt: number
  status: "pending" | "allow" | "deny" | "cancelled"
}

export class ApprovalBrokerDouble {
  private readonly requests = new Map<string, ApprovalRequest>()
  private nextId = 1
  public constructor(private readonly now: () => number = () => Date.now()) {}

  public request(capability: P3Capability, resource: string, expiresAt: number): ApprovalRequest {
    const request = { id: `approval-${this.nextId++}`, capability, resource, expiresAt, status: "pending" as const }
    this.requests.set(request.id, request)
    return request
  }

  public resolve(id: string, decision: "allow" | "deny", actor: string, grantedResource?: string): P3Decision {
    const request = this.requests.get(id)
    if (!request || request.status !== "pending") return { kind: "deny", ruleId: "C3-invalid-request", reason: "unknown-or-closed-request" }
    if (this.now() >= request.expiresAt) {
      request.status = "deny"
      return { kind: "deny", ruleId: "C3-timeout-deny", reason: "approval-expired" }
    }
    if (!actor) return { kind: "deny", ruleId: "C3-actor-required", reason: "missing-actor" }
    if (grantedResource !== undefined && grantedResource !== request.resource) {
      request.status = "deny"
      return { kind: "deny", ruleId: "C3-narrow-scope", reason: "grant-exceeds-request" }
    }
    request.status = decision
    return decision === "allow"
      ? { kind: "allow", ruleId: "C3-explicit-approval" }
      : { kind: "deny", ruleId: "C3-explicit-deny", reason: "actor-denied" }
  }

  public cancel(id: string): P3Decision {
    const request = this.requests.get(id)
    if (!request || request.status !== "pending") return { kind: "deny", ruleId: "C3-cancel-invalid", reason: "unknown-or-closed-request" }
    request.status = "cancelled"
    return { kind: "deny", ruleId: "C3-cancel-effective", reason: "approval-cancelled" }
  }
}

export type LicenseVerdict = "MIT" | "Apache-2.0" | "RESTRICTED" | "FSL-1.1-MIT" | "UNKNOWN"
export type ProvenanceRecord = {
  sourceRepo: string
  sourceCommit: string
  path: string
  digest: string
  license: LicenseVerdict
  nestedLicenses?: LicenseVerdict[]
  attribution?: string
}

export class ProvenanceGateDouble {
  public evaluate(record: ProvenanceRecord): P3Decision {
    if (!record.digest || !record.sourceCommit || !record.sourceRepo) return { kind: "deny", ruleId: "C4-identity-required", reason: "incomplete-provenance" }
    if (record.path.split("/").includes("ee")) return { kind: "deny", ruleId: "C4-ee-refused", reason: "excluded-path" }
    if (record.license === "RESTRICTED" || record.license === "FSL-1.1-MIT" || record.license === "UNKNOWN") return { kind: "deny", ruleId: "C4-license-refused", reason: "inadmissible-license" }
    if (record.nestedLicenses?.some((license) => license === "RESTRICTED" || license === "FSL-1.1-MIT")) return { kind: "deny", ruleId: "C4-nested-wins", reason: "nested-license-is-more-restrictive" }
    if (record.license === "Apache-2.0" && !record.attribution) return { kind: "deny", ruleId: "C4-apache-attribution", reason: "attribution-required" }
    return { kind: "allow", ruleId: "C4-admissible" }
  }
}

export type LifecycleState = "registered" | "approved" | "materialized"
export class CapabilityLifecycleDouble {
  private readonly entries = new Map<string, { state: LifecycleState; enabled: boolean }>()

  public install(digest: string): P3Decision {
    if (this.entries.has(digest)) return { kind: "deny", ruleId: "C5-no-overwrite", reason: "digest-already-installed" }
    this.entries.set(digest, { state: "registered", enabled: false })
    return { kind: "allow", ruleId: "C5-install-registered" }
  }

  public approve(digest: string, provenance: P3Decision): P3Decision {
    const entry = this.entries.get(digest)
    if (!entry || provenance.kind !== "allow") return { kind: "deny", ruleId: "C5-enable-needs-provenance", reason: "provenance-required" }
    entry.state = "approved"
    return { kind: "allow", ruleId: "C5-approved" }
  }

  public materialize(digest: string): P3Decision {
    const entry = this.entries.get(digest)
    if (!entry || entry.state !== "approved") return { kind: "deny", ruleId: "C5-materialize-needs-approval", reason: "approval-required" }
    entry.state = "materialized"
    return { kind: "allow", ruleId: "C5-materialized" }
  }

  public enable(digest: string, provenance: P3Decision): P3Decision {
    const entry = this.entries.get(digest)
    if (!entry || entry.state !== "materialized" || provenance.kind !== "allow") return { kind: "deny", ruleId: "C5-enable-needs-provenance", reason: "materialized-admissible-component-required" }
    entry.enabled = true
    return { kind: "allow", ruleId: "C5-enabled" }
  }

  public inspect(digest: string): { state?: LifecycleState; enabled: boolean } {
    const entry = this.entries.get(digest)
    return { state: entry?.state, enabled: entry?.enabled ?? false }
  }
}

export type RemoteConfig = { mode: "token" | "allowlist" | "pairing" | "open" }
export type RemoteEnvelope = { id: string; credential?: string }
export class RemoteTransportDouble {
  private readonly revoked = new Set<string>()
  private readonly seen = new Set<string>()
  public constructor(config: RemoteConfig) {
    if (config.mode === "open") throw new Error("open transport is forbidden")
  }

  public receive(envelope: RemoteEnvelope): P3Decision {
    if (!envelope.credential) return { kind: "deny", ruleId: "C7-no-credentials", reason: "identity-required" }
    if (this.revoked.has(envelope.credential)) return { kind: "deny", ruleId: "C7-revoked", reason: "identity-revoked" }
    if (this.seen.has(envelope.id)) return { kind: "deny", ruleId: "C7-replay-denied", reason: "message-replayed" }
    this.seen.add(envelope.id)
    return { kind: "allow", ruleId: "C7-authenticated" }
  }

  public revoke(identity: string): void { this.revoked.add(identity) }
}