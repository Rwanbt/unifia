<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-055 — Mode changes play the reference's choreography

- Status: accepted (owner request 2026-09-24)
- Date: 2026-09-24
- Related: ADR-053, shell/mode-motion.ts, pages/layout.tsx

## Context

Switching mode (Code, Work, Design, Automate) swapped the main card, the
context body and the crumbs instantly. The reference (UnifiaMotionV83)
clones the outgoing main card and context body as fixed ghosts that fall
34/24px and fade, slides the incoming ones in from the right, and swaps
changed texts with a 10px slide.

## Decision

`shell/mode-motion.ts` owns this choreography with the reference's
durations and curves. `withModeMotion(change)` wraps the rail and phone
bottom bar destination handlers; the mode context stays free of DOM code.
It is skipped with `data-ui-animations="off"` or reduced motion.

## Consequences

The incoming half runs two frames after the route change; a surface that
suspends longer than that appears without the slide.
