<!-- SPDX-License-Identifier: MIT -->
# RC-1 production scope freeze

Status: **ACTIVE** for RC-1 planning.  
Baseline used for the freeze: `dev@8955514a934dbb55304468490ceb30185ed09af3`.

This file is the scope overlay for RC-1. It does not replace ADRs, runtime authorities or the v110 acceptance matrix. It answers one question only: **does a declared/visible capability have to be real for RC-1, or may it be absent?**

## Rules

A visible production control MUST be one of:

- **REQUIRED** — must be backed by a shipped authority/runtime and RC evidence.
- **REQUIRED_CERTIFY** — implementation exists, but RC evidence is still required.
- **DEFERRED_HIDDEN** — not in RC-1; the control is absent/disabled with an explicit explanation and tracking issue.
- **NOT_IN_RC1** — a whole platform/capability family excluded by an explicit owner/release decision.

No other state is valid for a production UI. In particular, `SOON`, a local-only mutation, a decorative value, or a dormant component is not a shippable implementation.

A capability is not DONE because code exists. DONE requires:
`authority/contract -> implementation -> transport/persistence -> shipped consumer -> test/evidence`.

## RC-1 required capability closure

| Area | Capability / remaining contract | RC-1 disposition | Tracking |
|---|---|---|---|
| Home | `home.glance` | REQUIRED | #550 |
| Shell | workspace tabs / `shell.workspace-tabs` | REQUIRED | #551 |
| Code | mobile/compact `code.diff` | REQUIRED | #588 |
| Code | Code Lens | REQUIRED | #96 |
| Code | Inline AI suggestions | REQUIRED | #96 |
| Code | diagnostics/blame/search already implemented | REQUIRED_CERTIFY | #96 #564 |
| Work | real run/gate/task actions beyond status mutation | REQUIRED | #580 |
| Automate | dry-run/test + Work handoff | REQUIRED | #555 |
| Automate | scheduler/external triggers | REQUIRED | #556 |
| Automate | schema-backed runnable node editors | REQUIRED | #557 |
| Memory | governed-path closure and default-vault containment | REQUIRED | #493 #564 |
| Browser | shipped Node-host/runtime path | REQUIRED | #118 #279 #398 #400 #406 |
| Browser | takeover/observation/network/secrets/download/isolation | REQUIRED | #554 |
| Settings | AI routing/local/fallback profiles | REQUIRED | #560 |
| Settings | Compute/Network/Security/System/Hooks real backends | REQUIRED | #561 |
| Account | session/device/org/security actions | REQUIRED | #562 |
| Observability | canonical producers for declared domains | REQUIRED | #563 |
| Voice | Voice v2.2 G0-G14 production qualification | REQUIRED | #117 |
| UI | deterministic visual/a11y certification | REQUIRED | #549 #579 |
| Responsive | viewport/motion/keyboard closure | REQUIRED | #553 |
| Package wiring | strategic runtime reachability/deprecation decisions | REQUIRED | #565-#574 |
| Release | reproducible dry-run, signing, SBOM, checksums, provenance | REQUIRED | #576 |
| Release | immutable RC and `dev -> main` promotion | REQUIRED | #577 |
| Release | clean-install, notes, rollback, publish/canary | REQUIRED | #578 |

## Previously accepted RC-0 divergences

Older v110 notes used “DIVERGENCE ACCEPTÉE” when no runtime existed. For RC-1 these entries are **historical observations, not automatic exclusions**.

Where RC-1 now has an implementation issue (#560-#563, #580, #588, etc.), the issue supersedes the old “do not fabricate UI” decision with a stronger rule: **build the real capability or keep it unavailable until it is real**.

No RC-0 divergence may be silently interpreted as `NOT_IN_RC1`.

## Platform claims

Platform scope is frozen only when #575 records the candidate matrix. Windows, Linux, macOS, Android, Web/PWA, CLI/headless and iOS/iPadOS must each become either:

- `CERTIFIED` on the immutable RC SHA/artifact; or
- `NOT_IN_RC1` through an explicit release decision and release-note limitation.

Absence of evidence is never an implicit exclusion.

## E2E exclusions

#480 is part of the RC-1 scope. Every skipped/fixme journey must be:

1. re-enabled and green; or
2. tied to a capability explicitly marked `DEFERRED_HIDDEN`/`NOT_IN_RC1`.

A skip is never evidence that the capability is supported.

## Exit criteria for RB07 / FX00

This scope freeze is complete when:

- every declared-but-unwired v110 item has a tracking issue;
- production matrices reference this scope;
- no visible production control is allowed to remain fake/local-only;
- deferred capabilities are explicit and hidden/disabled;
- future changes to RC-1 scope require an issue/ADR/release decision rather than an undocumented UI change.
