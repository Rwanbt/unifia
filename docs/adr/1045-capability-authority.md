<!-- SPDX-License-Identifier: MIT -->

---
id: 1045
title: Capability authority and the capability-runtime disposition
status: ACCEPTED
date: 2026-10-16
ratified: 2026-10-16
related: [1034]
---

# ADR-1045: One shipped capability authority, capability-runtime deferred to 3B

## Context

RC-1 lot PW01 (#566) asks one named authority to own capability
evaluation, with no bypass from UI, agent or tool effects, and with the
deferred package either wired or formally disposed. The owner ratified
the disposition on 2026-10-16 (PR #747): **3A now — keep the capability
authority actually shipped; 3B after RC-1 — migrate to
`@unifia/capability-runtime` under a new ADR with mapping, shadow
evaluation and a verified cutover** (#623). This ADR records that
disposition and names the shipped authority; it does not certify #566's
remaining evidence or authorize a second authorization path.

`@unifia/capability-runtime` is classified `deferred-runtime` in
`scripts/package-wiring.json` with a generic reason ("tested engine with
no importer in shipped code"). Its own documentation shows why it is not
an RC-1 drop-in: `registry.ts:62-66` accepts a `ManifestVerifier` for the
future wiring of `verifyManifest` — the signature check does not run yet
— and `registry.ts:15-19` holds revocations in an in-memory `Map` until
the durable adapter lands. The earlier PW01 audit recorded both, and the
owner's decision keeps them out of RC-1.

Meanwhile the product already ships a working, layered authority. Its
decision contract is the accepted **ADR-1034** (token capability scope vs
the approval broker — who is authoritative): the token's own scope
answers "was this caller ever handed this capability at all?", and the
`CapabilityGate` answers "is this operation, on this resource, currently
allowed, approved, or does it need approval?" — checked in that order.
Both RC-1 hardening slices of decision 3A merged on 2026-10-16: #705
(gate native workflow start and run) and #709 (enforce native Workflow
workspace authorization before effects).

## Decision

**1. The canonical RC-1 capability authority is the shipped three-layer
path, and it is the only one:**

- **Lease issuance (native / sidecar).**
  `packages/desktop/src-tauri/src/lib.rs`
  (`ALLOWED_CONNECTION_CAPABILITIES`, `workbench_issue_token`,
  `workbench_rotate_token`) refuses any requested capability outside
  `workspace.read`/`workspace.watch`; `packages/unifia/src/server/workbench.ts`
  validates each requested capability against the known `P3_CAPABILITIES`
  before `issueNativeScopedToken`. A lease that would contradict the
  server's rules cannot be issued.
- **Request-time evaluation (server).**
  `packages/workbench-server/src/index.ts` `#checkCapability`: the
  principal's token scopes are checked first (hard `403`, gate never
  runs) unless the capability is in `STEP_UP_ELIGIBLE_CAPABILITIES`
  (`packages/workbench-server/src/constants.ts`); only then does the
  `ApprovalCapabilityGate` + `ApprovalBroker`
  (`packages/workbench-server/src/approval-gate.ts`) decide allow /
  approval-required / deny on the specific resource.
- **Route-native enforcement.** Every autonomous route goes through
  `#checkCapability` or an equivalent per-route gate, including the
  native Workflow start/run authorization (#705, #709,
  `packages/workbench-server/src/handlers/workflows.ts`), the desktop and
  browser surfaces, and the capability registry routes.

ADR-1034 remains the decision contract for that order; this ADR names
the authority and its disposition, and neither re-opens ADR-1034 nor
duplicates it.

**2. `@unifia/capability-runtime` stays `deferred-runtime` for RC-1.**
Its manifest entry points at this ADR and at #623. It is not imported
"for reachability": ADR-096's rejected alternative applies here word for
word — an import that makes the graph green without putting the package
on the real decision path is a false shipped claim. 3B starts only after
RC-1 with its own ADR and: origin/scope mapping, shadow evaluation with
no effects, durable revocation (the in-memory map replaced), real use of
the manifest verifier, single-writer cutover verified, and rollback.
Never two concurrent permission authorities.

**3. Hardening continues under 3A, not as new features.** Defects found
in the shipped path are fixed there (as #705/#709 did for the native
Workflow entry); no new capability surface is introduced in RC-1.

## Rejected alternatives

- **Wire `capability-runtime` now.** Its signature verification does not
  run and its revocation is in-memory — shipping it as the authority
  would weaken the boundary it claims to strengthen, and a second path
  next to the gate is exactly the dual authority the decision refuses.
- **Delete `capability-runtime` immediately.** Discards tested 3B
  candidate semantics without a migration decision; 3B is ratified as
  future work, not cancelled.
- **Replace the shipped gate pre-RC-1.** Out of the 3A scope, and a
  permissions migration without mapping/shadow/rollback evidence is the
  opposite of what 3B requires.

## Consequences

- One decision path for RC-1, already proven by the shipped suites (see
  the evidence list on #566): token-scope refusals before the gate,
  step-up only for the eligible set, approval expiry, and workflow
  authorization before effects.
- The manifest no longer reads as an unfinished task: the entry states
  the disposition and the successor issue.
- Post-RC-1 work has a written contract: 3B requires its own ADR, a
  mapping from grants to the shipped semantics, shadow evaluation, and a
  verified cutover — not an import.
