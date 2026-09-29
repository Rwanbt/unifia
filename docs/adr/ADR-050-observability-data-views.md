<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-050: The Observability data views get their own modules

- Status: accepted
- Date: 2026-09-24
- Related: ADR-047 (settings follow the reference's structure)

## Context

`settings-observability.tsx` held every sub-tab inline (769 lines). The
Traces and Events tables were duplicated, and the Comparisons cards were
written with inline styles instead of the reference's views (`.obs-table`,
`.status-pill`, `.event-dot`, `.cohort-table`, `.comparison-bars`). The
reference's Timeline and Cost views were missing entirely.

## Decision

- The event table (Traces and Events) moves to `settings-observability-events.tsx`.
  The Comparisons view moves to `settings-observability-compare.tsx`. Timeline
  and Cost stay in their own files. The page only switches between them.
- The pure mappings live in `settings-observability-format.ts`, which is
  unit tested:
  - event kind to dot colour;
  - status to pill tone;
  - duration and cost formatting;
  - daily cost buckets.
- Every figure comes from an existing endpoint. The Cost chart's daily
  buckets are derived from `summary/aggregate` totals at day boundaries.
  Values the server does not record, such as tokens per configuration, show
  "—" and are never estimated.
