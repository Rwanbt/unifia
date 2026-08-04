<!-- SPDX-License-Identifier: MIT -->
# Gate C — état d’exécution au 2026-08-03

## Décision provisoire : NO-GO

Cette décision est volontairement provisoire : elle reflète les critères du plan V3 et les preuves locales disponibles, sans prétendre à une release publique.

| Domaine | Preuve locale | État |
|---|---|---|
| Contrats et typecheck | `bun run typecheck` : 20/20 packages green après Skill Hub | PASS |
| Skill Hub local | `@unifia/skill-hub`, manifeste strict, signatures trustées, search/install/update/rating, `5/5` | PASS local |
| MCP UI | broker déclaratif + route `/v1/ui/actions`, `WorkbenchServer: 29/29` | PASS partiel |
| Generative UI | renderer allowlisté, IDs stricts, actions injectées, `3/3` | PASS contrat |
| Memory / Workflow | runtimes et routes existants, validations antérieures | PASS local |
| Computer use | brokers navigateur/bureau, redaction, emergency stop, tests locaux | PASS technique partiel |
| Gate A / Gate B | rapports présents mais validation finale et audit externe non établis dans cette session | NON PROUVÉ |
| MCP UI 100+ capabilities, transports JSON-RPC/STDIO, OAuth/JWT, rate limiting | non livré dans l’exécution actuelle | NON |
| OpenDesign complet, Artifact Studio complet | non prouvé par les gates locaux actuels | NON PROUVÉ |
| Security audit externe, pentest, demo 90 min, migrations no-breaking | aucun artefact externe disponible | NON |

## Garde-fous

- Les dépôts sources `D:\App\OpenCode\opencode` et les clones Hermes ne sont pas modifiés.
- Aucun code `/ee`, `remoteCode` ou licence interdite n’est introduit par les lots validés.
- Les bundles locaux servent de sauvegarde avant toute étape suivante.
- La décision finale Gate C reste interdite tant que les critères bloquants et l’audit externe ne sont pas prouvés.

## Prochaine carte unique

Intégrer `@unifia/skill-hub` et `renderGenerativeUi` au bootstrap Workbench avec tests HTTP de scope, allowlist UI et install/update ; ensuite seulement réévaluer Gate C.


## Re-evaluation 2026-08-04

- Typecheck monorepo: 20/20 packages green.
- Skill Hub hardening: `8/8` checks; Workbench HTTP: `49/49`; CapabilityRegistry: `6/6`.
- Route `POST /v1/ui/render` now integrated with server-injected action allowlist, workspace scope, prop filtering and fail-closed behavior.
- Checkpoints: `f11094a`, `b986905`, `a94601e`; bundles preserved locally.
- Decision remains NO-GO: no real DOM consumer/E2 external, no MCP transports/OAuth/rate-limit proof, OpenDesign/Artifact Studio and release/security gates not complete.
- Next card unique: close the external and product-surface gates; do not claim production readiness from local package tests.

## Re-evaluation 2026-08-04 (second pass)

Decision: **still NO-GO**. Four of the previously listed gaps are now closed
with local proof, and one new blocker was found that is more fundamental than
any of them.

### Closed since the previous entry

| Gap | Evidence | Commit |
|---|---|---|
| MCP transports (JSON-RPC / STDIO) | `@unifia/mcp-transport` 32/32: strict codec, newline framing with a bounded frame, correlation, deadlines, AbortSignal cancellation, per-method authorisation, rate limiting | `907a4c0` |
| Auth and rate limiting on the server | Principal authentication is a required constructor dependency; HS256 verification with pinned alg and iss/aud/exp/nbf; fixed-window limiter always installed; 429 and 401 audited | `3bfbf66` |
| Migrations no-breaking | 8 migration conformance checks; a newer-schema state file is now preserved and refused instead of silently discarded and overwritten | `7ff7dd1` |
| Reproducible conformance / supply chain | `scripts/unifia-conformance.mjs` + CI workflow, 8/8: forbidden paths, excluded imports, SPDX, licences, dependency pinning, lint, typecheck, 25 suites | `8f1b860` |

### Defects found and fixed during this pass

1. **SSE framing was unusable** (`eff4a51`) — frames carried literal `\n`
   characters, so no SSE client could parse the event stream. The existing test
   substring-matched the payload and never saw it.
2. **Silent workspace data loss** (`7ff7dd1`) — every state read error was
   swallowed identically, so a corrupt or newer-schema file produced a fresh
   empty state that the next save overwrote.
3. **Unifia code was outside every quality gate** (`8f1b860`) — `biome.json`
   listed only inherited OpenCode packages; 25 lint violations and 25 files
   without an SPDX header had accumulated unseen.
4. **A stale security invariant** (`8f1b860`) — the capability/effect
   completeness check asserted a hardcoded count of 14 and had been failing
   since `workflow.run` was added; it ran in no gate, so nobody saw it.

### New blocker, higher priority than the previously listed residuals

**No process exposes the WorkbenchServer.** Searching `new WorkbenchServer`
across the repository returns only its own test file. Every route proof is a
library proof: an in-memory `server.fetch(new Request(...))` with no socket, no
listener and no lifecycle. "Serveur headless" — a Phase 5 exit criterion and a
Gate A condition — is therefore `NON PROUVÉ`, and both the DOM consumer and the
external E2E are blocked behind it.

### Remaining NO-GO reasons

- No headless bootstrap (above) — addressed by `NEXT-CARD-2026-08-04.md`.
- Phase 11 OpenDesign: nothing beyond `docs/adr/0017-opendesign-integration.md`.
- Phase 12 Artifact Studio core: artefacts are content-addressed with no version
  lineage, no semantic diff, no sandboxed preview, no metadata stripping.
- No real DOM consumer for the Generative UI renderer.
- No external MCP provider connected (deliberate: requires provenance review).
- External audit, pentest, 90-minute demo and signed release: `BLOQUÉ EXTERNE`.

Full phase-by-phase evidence: `PHASE-STATUS-2026-08-04.md`.
