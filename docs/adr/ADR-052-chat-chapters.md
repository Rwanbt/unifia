<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-052 — Chat chapters: pins are a per-workspace user bookmark

- Status: accepted (owner request 2026-09-24: make "pin" functional)
- Date: 2026-09-24
- Related: ADR-045 (message anatomy), A3-01 prompt index

## Context

The reference's message shelf pins a message "as a chapter": an accent bar
beside it, a "Chapitre" tag above it, kept across reloads. The button was
disabled because nothing stored the pin and nothing let the user jump to it.

## Decision

- A chapter is a reading bookmark of this user, not conversation content, so
  it lives in the app's persisted storage per workspace (`chapters`, one id
  list per session) -- where line comments already live -- not on the server.
- `@unifia/ui` exposes a `ChaptersProvider` context; `PinChapterAction` and
  the message components read it. Without a provider the pin stays disabled,
  so other hosts of the ui package keep the old behaviour.
- The prompt index is the navigator: a turn whose prompt or reply is pinned
  shows an accent tick with a dot, and its tooltip says "Chapitre".

## Consequences

- Pins do not follow the user to another device; a server field would be
  needed for that.
- A pinned message later reverted leaves a harmless unused id in storage.
