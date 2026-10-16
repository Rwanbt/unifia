<!-- SPDX-License-Identifier: MIT -->
# ADR-096 — Canonical Knowledge authority versus dormant memory-governance

**Status:** ACCEPTED — owner decision 5A ratified 2026-10-16 (#569, #581; recorded by #747)
**Date:** 2026-10-15
**Scope:** RC-1 shipped memory. Complements ADR-090; does not supersede it.

## Context

The shipped `unifia` sidecar, Memory panel and memory tools use the Sovereign Knowledge Core through `packages/unifia/src/knowledge/app/memory.ts`. Its `openMemory` composes a governed vault once per root, provider, destination, access mode, operator egress setting and audience. The default project vault is `.unifia/memory`; configured roots are explicit. The facade owns data policy and controls recall/egress. The owner-only HTTP Knowledge routes use this same composition, reject untrusted Host/Origin and non-operator callers, and never open the vault before authority checks. ADR-090 already establishes CLI/server vault and policy parity.

A different tested package, `@unifia/memory-governance`, wraps `@unifia/memory-runtime`: it defines candidate promotion, consent, sensitivity, compartment tags and an independent `remember/remove/search` store contract. It does **not** import or operate on the Knowledge vault. `scripts/package-wiring.json` currently classifies it `deferred-runtime` (#569). A successful package unit test does not make it reachable from a distributed Unifia binary.

Importing the dormant wrapper merely to make the wiring check green would introduce two possible memory write and governance authorities. That would contradict the shipped vault's policy and provenance rules and could bypass their egress gate.

## Decision

1. **For RC-1, the shipped Sovereign Knowledge Core remains the sole canonical memory data, policy, write, and disclosure authority.** Its application entry is `openMemory` and its own `composeKnowledgeService` facade; agent recall, CLI, Memory panel and read-only owner routes must not maintain independent memory copies.
2. **Keep `@unifia/memory-governance` nonshipped and explicitly deferred while #569 remains open.** It is neither silently declared delivered nor imported as a facade. Its `MemoryRuntime` records are not an alias for Knowledge notes.
3. **Do not auto-migrate or dual-write.** Any future adoption must first map origins, consent, compartments, fingerprints, classification and retention into the Knowledge schema/policy with a versioned migration, rollback, exact record lineage, denial/egress tests and a single-writer cutover. Owner approval is required for any migration or change of authority.
4. Preserve existing safety invariants: operator-only Knowledge HTTP access, Host/Origin validation, default-root confinement, no read-side vault creation, policy-controlled remote disclosure, and unknown/withheld notes being indistinguishable to unauthorized callers.
5. This ADR does not certify Android/Windows qualification, physical Voice, package production reachability beyond today's manifest, or complete #569. Do not close #569 until an exact-SHA shipped-path regression suite proves the single authority.

## Rejected alternatives

- **Ship both memory stores:** two independently writable histories, consent ledgers and disclosure gates can diverge.
- **Import `memory-governance` from a production root only for reachability:** the package is still not on the actual write/recall path, creating a false shipped claim.
- **Point the new wrapper directly at Knowledge storage without a migration contract:** its tag-based fingerprints, mutable record model and consent API do not establish equivalence with the Knowledge vault's provenance and policy.
- **Delete `memory-governance` immediately:** destroys tested candidate semantics without a separately approved, tested migration into Knowledge.

## Required verification before closing #569

- Run `node scripts/check-package-wiring.mjs`; it must continue to report the package as deferred, never shipped.
- Run `bun test test/server/knowledge-authority.test.ts test/server/loopback-host.test.ts --timeout 30000` from `packages/unifia`; verify owner/Host/Origin denials.
- Run the existing Knowledge CLI/server vault parity tests at an exact commit; a single note and policy must be shared, never mirrored into a second directory.
- Add/confirm shipped-path tests covering agent memory write and read, local/remote egress deny, withheld/missing note equivalence, unauthorized raw access and no write on a refusal. Record commands, results and exact SHA.
- Review all memory writers in distributed roots for an independent `MemoryRuntime.remember` or an indirect `memory-governance.promote`; if discovered, investigate and fix before claiming sole authority.
- Owner decision 5A accepts this authority choice. Any removal, migration or change of the package's classified lifecycle still requires separate approval and migration/security evidence. `PHYSICAL_TEST_REQUIRED` remains where platform evidence is absent.

## Consequences

This is an architecture disposition, **not** a claim that PW04 is fully shipped or done. Knowledge remains the only advertised memory system. `@unifia/memory-governance` stays a separately tested, deferred candidate under #569. Follow-up technical tasks may port missing governance behaviors into the canonical Knowledge facade, each with no-secret-leak and data-migration regression tests; changes stay in PRs to `dev` and never trigger a release.
