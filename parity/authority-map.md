<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors

Original work. No upstream derivation.
-->

# Authority map — sources of truth for the v110 visual port

In descending priority; any conflict must surface, never be silently resolved.

1. **Appearance** — `docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html`
   SHA-256 `6c01e84c27abf7665bb4de65e0c3969b7af0f020129aa971916376b1ca69818b`.
   Read-only. Never modified by the qualification.
2. **Behavior** — `docs/ui-reference/v110/INTERACTIONS.md` + real stores in
   `packages/app/src/context/*` + capabilities. The maquette is a visual demo;
   the behaviour must come from the real runtime.
3. **Responsive** — `docs/ui-reference/v110/RESPONSIVE-MATRIX.md` + real
   `packages/app/src/tokens/viewport.ts`.
4. **Architecture** — accepted ADRs. ADR-042 is referenced by R7 and is
   pending acceptance; the unifia repo currently ships `docs/adr/1042-…` only.
   ADR-038 (semantic tokens, Phase 38) supersedes earlier visual token work.
5. **Design ownership** — `parity/design-ownership.json` (created at PF0).
6. **Parity contracts** — `parity/path-classification.json`,
   `parity/census-merge-policy.json`, `parity/probe-policy.json`,
   `parity/mutation-spec.json`, `parity/state-policy.json`,
   `parity/style-profiles.json`, `parity/motion-policy.json`.
7. **GitHub #116** — tracker only. Body must be updated to point at R7 before
   the first qualification commit, but it never overrides the artefacts above.

Component map (existing delivered state): `docs/ui-reference/v110/COMPONENT-MAP.md` § 8.
Ownership / WRITE restrictions: `docs/ui-reference/v110/OWNERSHIP.md`.

## Locale authorities

- `fr-FR/ltr`, `de-DE/ltr` are first-class for the maquette.
- `ar/rtl` is second-class; the maquette should be visually flipped via
  `dir="rtl"`. If the maquette does not actually render RTL, the surface
  carries `UNSUPPORTED_REFERENCE` until a secondary authority is hashed
  (see § 16 of the plan).

## Locked artefacts (PF0)

| File | Purpose |
|---|---|
| `parity/environment-lock.json` | Tooling, reference, clock, fonts, DPR |
| `parity/path-classification.json` | Path → flags accumulation |
| `parity/probe-policy.json` | Allowlist of observation probes (DENY by default) |
| `parity/mutation-spec.json` | Mandatory mutation families |
| `parity/census-merge-policy.json` | Census identity + merge operator |
| `parity/design-ownership.json` | Design chrome allowlist / runtime denylist |
| `parity/generated-paths-policy.json` | Generated outputs to exclude from LOC |
| `parity/g0-derivation-policy.json` | G0 mode derivation rules |

Locks (L0, QF0) layer additional artefacts: `pilot-contract-lock.json`,
`full-contract-lock.json`, `aa-calibration.json`, `parity-run.json`.

## Forbidden short-cuts

- Touching the maquette bytes.
- Self-qualifying (`app = reference`) for any missing capability.
- `app-only-accessibility` without `mask: null`, owner and G3 proof.
- `retain-internal-instrumentation` for an anchor or census node without
  proof of visual absence.
- Bumping a pixel budget after the failure it should absorb.