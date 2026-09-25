<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-057 — Live orb in the topbar

- Status: accepted
- Date: 2026-09-25
- Related: ADR-058 (voice runtime), ADR-048 (accent colour), ADR-056 (hover panels)

## Context

The Jarvis topbar prototype V5 (`Unifia-UI-UX-v110-JARVIS-TOPBAR-PROTOTYPE-V5.html`)
adds an animated orb right after the Chat / Split / Editor switch: a click turns
the ambient voice presence on or off, hovering it while on opens a context peek.
The prototype drives it with demo states, a fixed cyan/violet/green/amber palette
and fake progress percentages. Live conversation already exists (ADR-058) and is
started from the composer's Live button, whose runtime was bound only there.

## Decision

The orb is the topbar entry point of the existing Live conversation, not a second
voice system. `live-store.ts` owns one `toggleLive()`; the composer binds its
context (session, agent, model, dictation hand-off) through `bindLiveRuntime`, and
both the composer button and the orb toggle through it. `voice/live-orb.ts` maps
the Live snapshot to the prototype's motion states and to the peek's rows (Voice
Host, agent, user intervention) — pure and unit-tested; `components/session/live-orb.tsx`
renders it with the shared hover intent (ADR-056). Colours are shades of `--accent`
(ADR-048) instead of the prototype palette; the peek shows an indeterminate activity
bar instead of invented percentages, and real actions (Settings, End Live) instead
of the demo buttons. `prefers-reduced-motion` stops the animations (v110.css).

## Consequences

- One conversation, two controls: stopping from either ends the same room.
- The orb appears once a composer has bound a Live runtime (Live enabled in
  Settings > Audio, microphone present), and stays while Live runs.
- No new dependency and no circular import: `live-orb.ts` depends on `live-state.ts`
  only; the component depends on the store, never the reverse.
