<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-046 — Chat observability: presets and domains filter the timeline

- Status: accepted (owner request 2026-09-23: update General settings to the
  maquette's "Observabilité du chat")
- Date: 2026-09-23
- Related: ADR-045 (chat message anatomy)

## Context

The maquette's General settings replace the lone "reasoning summaries" switch
with a chat observability block: four presets (Clean, Balanced, Full, Custom)
and 24 domains, each deciding whether that kind of step appears in the
conversation. The full trace stays recorded; only the timeline is filtered.

## Decision

- The domain model (list, presets copied from the maquette, part → domain
  mapping) is a pure module in `@unifia/ui` (`chat-observability.ts`), because
  the ui package does the filtering and the app only stores the choice.
- `SessionTurn`/`AssistantParts` take an `observability` predicate; a hidden
  domain removes its parts, the changed-files block (git) and the compaction
  divider. The trajectory domain hides the chat head's Execution button.
- A failed step belongs to "errors", whatever its tool. The reply's own text
  has no domain and is never hidden. Pending questions and permissions are
  docks, outside the timeline, so no preset can hide them.
- Reasoning keeps its existing setting (`showReasoningSummaries`), exposed as
  the "reasoning" domain, so nothing else reading it changes.
- Domains with no source in Unifia yet (artifacts, past approvals, browser,
  processes, routing, policies, hooks) are listed with a disabled switch and
  "Coming soon", rather than a switch that changes nothing.
- Usage (2026-09-24): a finished turn ends its step stack with a "Usage" row
  -- duration, tokens processed and cost, summed over the turn's replies.
- Default preset: Balanced, as in the maquette.

## Consequences

- Choices persist in `settings.v3` under `general.observability`; stores saved
  earlier fall back to Balanced without a migration.
- Adding a tool means mapping it in `toolDomain`, or it counts as an MCP tool.
