<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-042 — Session menu moves from the timeline title bar to the chat head

- Status: accepted (owner decision 2026-09-23)
- Date: 2026-09-23
- Related: ADR-038 (visual parity scope)

## Context

The maquette v110 chat has no title bar above the thread: the only chrome is
the `Conversation · scope · Exécution` head. The app still carried OpenCode's
sticky title bar inside `message-timeline.tsx`, and that bar was the only UI
for renaming and deleting a session, the way back from a sub-agent session to
its parent, and the share popover.

## Decision

The title bar is removed. Its actions move to `session-title-menu.tsx`, mounted
in the chat head: the `⋯` menu (rename, share, archive, delete) right of the
Exécution button, as the owner asked, and a back arrow before "Conversation"
only when the session has a parent. Rename becomes a small dialog because the
title is no longer displayed in the thread. The working spinner is dropped:
the composer's stop button already shows a running session.

## Consequences

- `message-timeline.tsx` loses about 350 lines and keeps one responsibility:
  rendering the turns.
- Sticky accordions and hash scrolling no longer offset for a title bar
  (their variables already defaulted to 0).
