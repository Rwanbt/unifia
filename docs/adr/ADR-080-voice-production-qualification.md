<!-- SPDX-License-Identifier: MIT -->
# ADR-080: Voice production qualification — mock ≠ host ≠ physical

**Date**: 2026-09-27 | **Status**: Implemented-as-principle (every gate row in the state file carries the qualifier; physical evidence attached to exact SHAs)

## Context

§46 and §49 require that production qualification be evidence-bound, not commit-bound. A green CI run, a passing host unit test, a clean compile of the APK, and a single warm-up fixture on a five-language corpus are not the same thing as a device that can run Voice. The pre-v2.2 campaign accumulated commits labelled R4–R8 / R11 / R13 / R14 whose real qualification status was scaffold or host only; this ADR fixes the bookkeeping so future audits do not have to re-derive the qualifier for every gate.

## Decision

Every Voice gate is classified with one of these qualifiers, in this priority order:

1. **SUPERSEDED** — replaced by a later ADR.
2. **DRAFT** — the decision exists; the implementation does not (yet).
3. **IMPLEMENTED host** — the code compiles, the host unit / integration tests pass against the canonical reference, but the runtime has not run on the target device.
4. **IMPLEMENTED physical** — the runtime has run on the target device and produced evidence attached to an exact source SHA, but the qualifying evidence does not yet cover the gate's full scope (e.g. only one route, only one language, only one device).
5. **QUALIFIED physical** — full-scope physical evidence is attached to an exact source SHA, in `docs/operations/voice-v2-autonomous-state.md`, and the gate's mandatory measurements are within the §45 targets.

The state-file gate row carries the qualifier in plain text. Every ADR that ships with the campaign carries `Status:` set to one of the five values above. **`Status: Accepted` is no longer used for Voice ADRs** — the campaign has too many physical gates for a binary accepted/rejected classification.

Physical evidence records must include (§46): source SHA, APK or installer SHA-256, OS, device, architecture, provider IDs, model revisions, model SHA-256, language, local/remote profile, measured metrics, raw logs, and PASS / FAIL. A statement such as "tested successfully" is never sufficient evidence on its own; it must be backed by an attached log or measurement file.

## Alternatives rejected

- **Single QUALIFIED bit per gate**: hides the gap between "host green" and "device green" and let several pre-v2.2 commits claim production status on host numbers alone.
- **Treat CI green as production green**: §49 explicitly bans this — mandatory final facts include physical evidence attached to exact SHAs.
- **Treat any non-PASS result as a defect to be hidden**: §39 bans weakening assertions to make a red gate green; failures are surfaced and resolved.
- **Move qualification into a side document outside the state file**: the state file is the single authoritative checkpoint per §9; qualifying evidence lives there so future sessions can resume without re-deriving.

## Consequences

Every future Voice PR must update at least one gate row's qualifier and, when moving from `IMPLEMENTED host` to `IMPLEMENTED physical` or `QUALIFIED physical`, must attach the §46 evidence to the exact source SHA. CI green does not relax this — a PR can land with CI green and `IMPLEMENTED host` status, and a separate qualification commit carries the `IMPLEMENTED physical` or `QUALIFIED physical` status when the device evidence exists. The G0 / G1 / G14 gate rows already use this convention.
