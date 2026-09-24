<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-056 — Floating panels peek on hover, as in the reference

- Status: accepted (owner request 2026-09-24)
- Date: 2026-09-24
- Related: shell/hover-intent.ts, shell/account-quick-menu.tsx

## Context

The reference opens three floating panels on hover (v84/v87 premium hover):
the account quick menu from the rail avatar, the compute popover from the
server button and the terminal from the terminal button. The app only
opened them on click, and had no account quick menu at all.

## Decision

- `shell/hover-intent.ts` owns the reference's timing once: open after a
  190ms rest (205ms for the terminal), stay open while the pointer is on
  the trigger or the panel, close 360ms after it leaves both; a click pins
  the panel; touch never peeks.
- The account quick menu shows the real identity (ADR-051) and only
  entries with a real destination (account centre, settings). The
  reference's space switcher, join/create and lock entries have no backend
  and are left out rather than faked.

## Consequences

A new hover panel reuses `createHoverIntent` instead of its own timers.
