<!-- SPDX-License-Identifier: MIT -->

---
id: 1046
title: RC-1 secret boundary and the secret-broker deferral
status: ACCEPTED
date: 2026-10-17
ratified: 2026-10-16
related: [0008, 1027, 1028, 1042]
---

# ADR-1046: The shipped RC-1 secret boundary, and why the broker waits

## Context

RC-1 lot PW02 (#567) asks for one canonical secret boundary for tools,
Browser and privileged runtimes, with disclosure following policy and
redaction, and with `@unifia/secret-broker` either wired or explicitly
disposed. The owner ratified **4A** on 2026-10-16 (PR #747): keep the
secret boundary actually delivered for RC-1, harden it (handles,
permissions, tool-output redaction, SDK history, tool-call input,
provider egress, logs/export — #708/#711), and keep the broker deferred
"tant qu'un manque obligatoire réel ne nécessite pas son intégration
sous une seule autorité". DLP does not replace authorization.

`ADR-010` (DECIDED, 2026-09-01) is the **model**: key hierarchy in the
OS store, `CredentialRef`/`SecretRef`/`OAuthConnectionRef` references
resolved by a Secret Broker, `AtRestProtectionEnvelope`, and REQ-2/REQ-3
("secret jamais en clair dans logs/traces", "secret jamais au LLM").
The broker that realizes it (`@unifia/secret-broker`) was never imported
by shipped code: `scripts/package-wiring.json` classifies it
`deferred-runtime`, and its only consumers are release-hardening gates
and tests.

What RC-1 actually ships in production is a different, narrower
mechanism, and it recently grew twice under this lot:

- `packages/unifia/src/security/dlp.ts` — `redact(text)` (rule set of
  provider/credential patterns) and `scanMessages(...)`, which walks
  outgoing message content including **nested SDK tool results** (#708).
- `packages/unifia/src/session/llm.ts` — tool-call **arguments** are
  masked with the same engine before provider egress
  (`redactArguments`, applied to `part.input`), and the outgoing message
  list passes `DLP.scanMessages` (#711).
- The same engine is the disclosure gate elsewhere: the Browser tool
  (`packages/unifia/src/tool/browser.ts` imports `redact`) and GitHub
  diagnostics (`packages/unifia/src/github/diagnostics.ts` redacts
  captured stderr before it is surfaced).

## Decision

**1. The canonical RC-1 secret boundary is the egress redaction gate
around `security/dlp.ts`.** One engine, applied at every shipped
disclosure point — provider egress (arguments and messages, including
nested tool results), Browser tool output, diagnostics surfaces — with
the evidence pinned in `test/security/dlp.test.ts` (rule coverage and
the nested tool-result cases) and `test/session/llm.test.ts` ("does not
disclose tool-call arguments containing secrets to the provider"). No
second redaction engine is added, and nothing imports `secret-broker`
merely to make the wiring check green — the false-reachability import
ADR-096 already rejected.

**2. This boundary is the delivered mitigation, not ADR-010's
reference model.** DLP is pattern-based and runs last; ADR-010's
ref-resolution (`CredentialRef` resolved by a broker near the executor,
REQ-12) remains the target for the stores that need it, and ADR-010 is
not superseded, replaced or re-opened by this ADR. RC-1 makes no claim
that a workflow payload carries only references today: what is proven is
that the shipped egress paths redact secret-shaped material, which is
the REQ-3 mitigation the owner chose for this release.

**3. `@unifia/secret-broker` stays `deferred-runtime` for RC-1** with
its manifest entry stating this disposition. Adoption starts only when a
**real obligatory need** is demonstrated (4A), under its own ADR and a
single authority, with: envelope/ref mapping against the shipped auth
stores, durable OS-store integration per ADR-010's platform matrix,
rotation/revocation evidence, the ADR-010 canary gate ("secret leak
count = 0" across history, logs, traces, LLM, artifacts, exports), and
a verified migration with rollback.

**4. Hardening continues where the boundary already is.** Defects found
in the shipped redaction/authorization paths are fixed there (as #708
and #711 did), and `DLP` never substitutes an authorization decision:
an unwired surface fails closed, and a capability refusal happens
before any disclosure path runs (ADR-1034).

## Rejected alternatives

- **Ship the broker now as the boundary.** No shipped importer, no real
  obligatory need demonstrated, and an OS store is a durability layer —
  it does not decide what may leave for a provider. Wiring it early
  would create the second authority 4A refuses.
- **Delete the broker.** It is the tested implementation path of
  ADR-010's model; deleting it discards a decided target without a
  replacement ADR.
- **Rely on provider-side handling or on "no secrets in prompts" as a
  convention.** Nothing upstream knows this repository's secret
  patterns; conventions are not gates.

## Consequences

- The RC-1 claim is precise: egress redaction with tests, not a complete
  ref-model — the difference is stated here so no later reader confuses
  the two.
- The manifest no longer reads as an unfinished task: the entry names
  the disposition and the conditions the successor must meet.
- The pattern set in `dlp.ts` is the one list to extend when a new
  credential shape appears; a change there is reviewed against the
  nested-content walk that #708 added.
