<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-045 — Chat messages follow the reference's message anatomy

- Status: accepted (owner decisions 2026-09-23: "comme la maquette" for steps,
  "plus complet dans la maquette" for message actions)
- Date: 2026-09-23
- Related: ADR-038 (visual parity scope), ADR-042 (chat head)

## Context

The v110 maquette gives each message a fixed anatomy: a column centred on the
chat surface, a named user bubble, an assistant row with a ✦ avatar and the
model's name, a hover shelf of actions floating under the message (copy,
branch, pin as chapter, read aloud, timing, rewind), and the reply's steps as
one bordered stack of rows with a status pill. The app rendered OpenCode's
anatomy: a fixed 800px column, an always-reserved meta row under each message,
and each tool as a free-standing collapsible.

## Decision

- Markup changes live in `@unifia/ui` (`session-turn.tsx`, `message-part.tsx`,
  `basic-tool.tsx`), because the layout (avatar row, floating shelf, step
  icon, status pill) cannot be reached with CSS alone. New shelf entries and
  the pill are small modules (`message-actions.tsx`, `tool-status-pill.tsx`)
  so `message-part.tsx`, already over the size ceiling, does not grow.
- The maquette's sizes and palette stay in the app's `v110-chat.css`, scoped
  to the chat, so other consumers of `@unifia/ui` keep neutral styling.
- The column width is `min(100%, 1080px, max(560px, 100cqw - 610px))`: the
  reference's doubled clamped half-width, expressed against the chat surface.
- "Pin as chapter" is shown disabled with "Coming soon": chapters need a
  persisted marker and a navigator, and a local-only toggle would lose the pin
  on reload. The assistant shelf has no branch button, because forking at an
  assistant message would drop that very answer from the fork.
- The status pill sits on the tool wrapper, which always knows the part's
  status; only 2 of 16 tool renderers passed it to `BasicTool`.

## Consequences

- The agent and model moved from the user message's meta row to the timing
  entry's tooltip; the assistant's model name is always visible in its row.
- The changed-files block is now inside the assistant column and joins the
  step stack when the reply ends on a step.
- Rejected: restyling OpenCode's markup with CSS only (no avatar row, no
  floating shelf without layout shift), and a chat-only fork of the message
  components (two anatomies to maintain).
