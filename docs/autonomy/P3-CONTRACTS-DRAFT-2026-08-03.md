# P3 — Security Foundation Contracts (Draft)

**Date**: 2026-08-03
**Status**: `DRAFT_FOR_REVIEW`
**Authority**: Plan directeur V3 — Unifia Workbench
**Evidence**: `M1-BEHAVIOR-EVIDENCE-2026-08-03.md`

This document defines contracts before implementation. It intentionally contains
no imported upstream code and no runtime changes.

## 1. Unifia Core authority

All agent sessions, providers, tools, permissions, secrets, memory and audit
records are owned by Unifia Core. Upstream OpenWork and Open Cowork components
may only be consumed through explicit ports/adapters.

Invariant: no adapter may create a second session, provider, tool or approval
authority outside the Core boundary.

## 2. PolicyEngine contract

```ts
interface PolicyEngine {
  evaluate(request: CapabilityRequest, context: PolicyContext): PolicyDecision;
}

type PolicyDecision =
  | { effect: "deny"; reason: string; ruleId: string }
  | { effect: "allow"; ruleId: string; expiresAt?: number }
  | { effect: "approval_required"; approvalId: string; ruleId: string };
```

Defaults: deny unknown capabilities, deny global workspace access, deny
arbitrary network, deny secrets combined with network/desktop control, and deny
all enterprise/commercial/unattributed components.

## 3. ApprovalBroker contract

```ts
interface ApprovalBroker {
  request(input: ApprovalRequest): Promise<ApprovalDecision>;
  resolve(id: string, decision: "allow" | "deny"): Promise<void>;
}
```

There is no unrestricted `auto` mode. An automation policy must be a named,
scoped, expiring rule evaluated by PolicyEngine and recorded in AuditRuntime.
Timeout is deny. Every decision includes actor, workspace, capability, resource,
rule and correlation id.

## 4. RemoteRuntime contract

```ts
interface RemoteRuntime {
  receive(message: RemoteMessage): Promise<RemoteDecision>;
}
```

Allowed modes are `token`, `allowlist` and `pairing`; `open` is invalid. Remote
messages are authenticated before routing, scoped to a workspace and capability,
rate-limited, replay-protected and audit-recorded. A channel adapter cannot call
agent tools directly.

## 5. SandboxBroker contract

```ts
interface SandboxBroker {
  checkPath(input: PathRequest): PathDecision;
  execute(input: CommandRequest): Promise<CommandResult>;
}
```

Path checks normalize separators, enforce workspace/session containment, resolve
symlinks when the target exists, reject forbidden system paths and never widen
the root because a command contains a Windows path. Existing-path and new-target
checks must be tested separately.

## 6. CapabilityRegistry contract

Every skill/plugin has a manifest, immutable source digest, licence/provenance
record, declared capabilities, workspace scope and enabled state. Installation
is not execution. Materialization is isolated and cannot silently grant tools,
network, secrets or desktop control.

Nested licence notices are attached to the component record; a root MIT licence
does not erase nested notices. OpenWork `/ee` is permanently excluded.

## 7. AuditRuntime contract

Every allow, deny, approval, remote receive, sandbox decision, install,
materialization and migration emits a structured event with timestamp, actor,
workspace, capability, resource, decision, rule id, source digest and
correlation id. Secrets and raw credentials are never persisted.

## 8. Required conformance tests before P3 implementation

- approval auto policy cannot allow an undeclared capability;
- approval timeout denies;
- remote `open` configuration is rejected;
- remote authentication precedes routing;
- replayed remote message is denied;
- sandbox rejects lexical escape and symlink escape;
- sandbox handles new write targets without widening containment;
- plugin install records digest/licence and does not enable execution;
- nested licence notice blocks unreviewed adoption;
- `/ee` path is rejected by provenance gate;
- every decision produces an audit event without secret material.

## Gate

`DRAFT_FOR_REVIEW`: implementation is blocked until an independent reviewer
accepts or amends these contracts. The next authorized action is review, not
upstream code import.