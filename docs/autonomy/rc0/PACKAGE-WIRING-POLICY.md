<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# PW00 — package wiring policy (proposal, the owner decides)

For every package declared `notShipped` in `scripts/package-wiring.json`:
**wire**, **park** or **delete**, with the evidence behind the verdict.

This is a proposal. Nothing here is applied: `scripts/package-wiring.json` is
untouched by this card, and PW01 (wiring `capability-runtime`) is explicitly
gated on the owner approving it.

## Baseline, measured

```
$ node scripts/check-package-wiring.mjs
package wiring ok: 25 reached from the shipped roots, 28 declared not shipped
```

`scripts/check-package-wiring.mjs` computes reachability by non-test source
imports from `shippedRoots` (`@unifia/app`, `unifia`, `@unifia/desktop`,
`@unifia/desktop-electron`, `@unifia/mobile`). Its own comment states the reason
it exists: *"a green suite says a package works, never that anything calls it;
the runtime packages behind release-hardening gates looked 'implemented' while no
shipped code imported them."*

**The card says 27 packages; the file now declares 28.** `@unifia/network-authority`
was added with its own reason ("Delivered ahead of its consumer"), so the count
in the card is stale by one. All 28 are covered below.

Two measurements shape most of the verdicts:

1. **Seven engines are reachable only from `@unifia/release-hardening`**, which is
   itself not shipped: `computer-use-safety`, `mcp-ui-actions`, `memory-governance`,
   `remote-bridge`, `document-packs`, `workbench-orchestrator`, `artifact-studio`.
   A release gate calling an engine is not a product surface.
2. **`@unifia/capability-runtime` and `@unifia/desktop-runtime` have no `main`, no
   `exports` and no `types`.** They are not importable as packages at all today.

## Verdicts

`DELETE` is recommended for **none**, and that is a decision, not an omission.
`DECISIONS.md` states the objective as *"Tout câbler sans exception, étape par
étape ; supprimer du câblage = régression d'objectif"* and *"Tous les PW/FX/BR sont
conservés"*. Deleting a workspace package also means a manifest edit and drops
its tests out of CI, so deletion is both an objective regression and a
lane-D action. Park is the honest verdict for anything without a named consumer.

| Package | Verdict | Why | What would change it |
|---|---|---|---|
| `@unifia/capability-runtime` | **WIRE** (blocked, needs owner) | Real engine: `enforce()` with trust classes + grant TTL, `Ed25519ManifestVerifier`, `createSecureCapabilityRegistry` (3 sources, 2 tests). It is the only package with a named target: the shipped server's `capabilities` dependency is not injected, so its routes answer 503. | Two blockers below. |
| `@unifia/scheduler` | **WIRE** (next) | Has a named consumer that is currently broken-by-absence: `docs/audit/AUDIT-CABLAGE-NEW-UI-2026-09-30.md` records `trigger.schedule` as "reste à running sans jamais se déclencher (aucun planificateur branché)". This is the engine that makes it fire. | Nothing structural; it needs the trigger wired in Automate. |
| `@unifia/network-authority` | PARK | Already declared as "delivered ahead of its consumer"; the Browser slices of #118 import it next, and D2 keeps Browser out of release 1. | Lands automatically with the Browser service. |
| `@unifia/browser-runtime` | PARK | 13 sources, 7 tests, imports only `contracts` + `network-authority`. D2 = Browser ships progressively after release 1. | The Browser surface switch (held on #279). |
| `@unifia/desktop-runtime` | PARK | No `exports` at all, so it cannot be imported yet; QA13/D5 platform work is open. | Manifest entry (lane D) + a desktop consumer. |
| `@unifia/artifact-store` | PARK | 1 source. Description: "caller-cannot-fix classification/taint/ownership/environment". The shipped artifact path already goes through `@unifia/artifact-runtime`, so wiring this would create a **second artifact authority** — the same duplication question as `capability-runtime`. | Owner decides whether artifact-store supersedes or decorates artifact-runtime. |
| `@unifia/artifact-studio` | PARK | Only consumer is `release-hardening`. Exports pptx/zip generation with no UI. | A Design/Work surface that produces artifacts. |
| `@unifia/document-packs` | PARK | Only consumer is `release-hardening`; already reached from `@unifia/artifact-runtime`. | A shipped document-generation surface. |
| `@unifia/computer-use-safety` | PARK | 1 source, only consumer is `release-hardening`. Computer-use is not a release-1 capability. | A release-1 computer-use surface. |
| `@unifia/remote-bridge` | PARK | 4 sources, only consumer is `release-hardening`. Remote access settings exist in the UI but route to the shipped remote path, not this. | The remote path being replaced by this one. |
| `@unifia/sandbox-drivers` | PARK | 1 source, no consumer. Sandbox behaviour is in the shipped tool layer. | A shipped sandbox driver selection. |
| `@unifia/secret-broker` | PARK | No consumer, but `@unifia/artifact-store` depends on it — deleting or parking it strands that dependency. | Resolve together with artifact-store. |
| `@unifia/memory-governance` | PARK | 1 source, only consumer is `release-hardening`; the shipped Memory surface uses `@unifia/memory-runtime`. | Memory retention/redaction policy landing in the server. |
| `@unifia/mcp-ui-actions` | PARK | 1 source, only consumer is `release-hardening`. MCP UI actions are not offered in release 1. | An MCP tool that returns UI actions. |
| `@unifia/workbench-orchestrator` | PARK | 1 source, only consumer is `release-hardening`. | A shipped orchestration surface. |
| `@unifia/observability` | PARK | Kernel logger + metrics + tracing. The app ships its own `Log` (`src/util/log`); wiring this would be a second logging authority. | A decision to replace the app logger. |
| `@unifia/media-runtime` | PARK | 2 sources, no consumer. | A shipped media surface. |
| `@unifia/generative-ui-dom` | PARK | 5 sources, imports the **shipped** `workbench-server`, so it is one hop away — but nothing imports it, and its UI would be generated, which is exactly what RB07 has not decided. | The generative-UI decision. |
| `@unifia/automate-m0-contract` | PARK | Declared "Qualification-only: not a production package" (ADR-000). Never shippable by design. | Never — park is the correct end state. |
| `@unifia/automate-m0-harness` | PARK | ADR-000 qualification harness, 16 tests. Blocks M1 by design. | Never. |
| `@unifia/release-hardening` | PARK | Release gates and qualification scenarios; it is the package that keeps the seven gate-only engines honest. | Never. |
| `@unifia/runtime-conformance` | PARK | Conformance harness; runs in CI. | Never. |
| `@unifia/web` | PARK | Documentation site (Astro), deployed separately from the product. | Never. |
| `@unifia/slack` | PARK | Slack bot, deployed separately. | Never. |
| `@unifia/function` | PARK | Cloud function, deployed separately. | Never. |
| `@unifia/enterprise` | PARK | Enterprise site, deployed separately (and excluded from the workspace by `package.json`). | Never. |
| `@unifia/script` | PARK | Build and release tooling. | Never. |
| `@unifia/storybook` | PARK | Component workshop, dev only; consumed by Storybook CI. | Never. |

Tally: 2 WIRE, 10 PARK-with-a-consumer-or-duplication-question, 16 PARK
permanently (tooling, harnesses, separately deployed).

## PW01 — `capability-runtime`: two blockers, not one

The card gates PW01 on owner approval. Even with approval it cannot be done
inside lane B, and one part of it should not be done blind.

**Blocker 1 — the package is not importable.** `packages/capability-runtime/package.json`
has no `main`, no `exports` and no `types`. Wiring it means editing a manifest,
and manifests are lane D (`bun.lock` included). Lane B cannot close PW01's DONE
criterion on its own.

**Blocker 2 — it would create a second authority.** `capability-runtime`'s
`enforce()` applies a grant TTL, and `workbench-server/src/approval-gate.ts`
already does: it imports `DEFAULT_GRANT_TTL_MS` from `./constants.js` and holds
`#grantTtlMs`, with the comment *"a granted decision only stays honored for
grantTtlMs"*. Both are 5 minutes. Wiring the runtime in without deciding which
path is authoritative would leave the shipped server enforcing grants twice,
through two independent code paths — a security-relevant choice, not a wiring
detail.

So PW01 as written in the card is under-specified. What it needs from the owner:

1. Is `capability-runtime` meant to **replace** `approval-gate.ts`'s TTL/trust
   enforcement, or sit beside it? If beside it, what is each for?
2. Which capability routes answer 503 today and must move to a 200, and does
   that need a `WorkbenchApp` dependency change in `workbench-server`?

Until both are answered, `NEEDS-OWNER PW01` and the package stays declared.

## PW01 — DECIDED 2026-10-06: park, do not wire

The owner delegated the judgement ("garder tout fonctionnel sans régressions").
The answer is **park**, and the reasoning is about not losing function:

- **Nothing that works today is lost by parking.** The shipped capability path is
  live and covered: `P3_CAPABILITIES` is the broker universe, `ApprovalBroker`
  resolves decisions, and `approval-gate.ts` enforces the grant TTL. Parking
  `capability-runtime` removes nothing from the product.
- **Wiring it beside the gate is the one option that guarantees regression risk.**
  Its `enforce()` applies a grant TTL `approval-gate.ts` already applies — both 5
  minutes. Two independent enforcement paths over grants is exactly the class of
  change that passes CI and fails in production.
- **Replacing the gate is safer than duplicating it, but it is a migration, not a
  wiring.** It changes security semantics that currently work, so it needs its own
  card and a security review. It is also not doable by this lane: the package has
  no `main`, `exports` or `types`, and adding them is a manifest edit (lane D).
- If the owner wants its specific capabilities — Ed25519 manifest signing, trust
  classes, the secure registry — the honest route is a migration card that retires
  `approval-gate.ts`'s duplicate logic in the same change, so there is only ever one
  authority.

`scripts/package-wiring.json` is unchanged and the `capability-runtime` entry keeps
its existing reason. The `notShipped` count stays 28.

## How to verify this proposal

```sh
node scripts/check-package-wiring.mjs      # must stay green; nothing here changes it
node -e "console.log(require('./scripts/package-wiring.json').notShipped.length)"   # 28
```

Per-package facts (source/test counts, `private` flag, `exports` keys, and which
shipped or not-shipped packages each one imports) were collected with the
checker's own `computeWiring` export, so the verdicts rest on the same
reachability definition the gate enforces.