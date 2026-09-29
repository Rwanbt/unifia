<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-047 — Settings follow the reference's structure

- Status: accepted (owner decisions 2026-09-23)
- Date: 2026-09-23
- Related: ADR-038 (visual parity scope), ADR-046 (chat observability)

## Context

The v110 maquette organises settings as 17 pages in five groups (Bureau, IA,
Infrastructure, Extensions, Système) under a command bar (title and save
state, search, "Pour : Moi / Projet", Guidé / Détails techniques). The app
still had OpenCode's two groups (Bureau, Serveur) and a few pages the maquette
does not name: Plugins, Se connecter, Remote access, Android.

## Decision

- The app adopts the maquette's groups, order and page names. Every existing
  page moves to where the maquette already covers it, with no duplicate:
  Plugins splits into MCP and Skills, Remote access and Android become
  Compute, Se connecter goes to Sécurité, updates and configuration
  export/import leave Général for Système.
- Controls with no backend in Unifia are shown, disabled, with "Coming soon"
  (as in ADR-046), never as controls that change nothing.
- "Pour : Moi / Projet" is wired: server settings that exist at both levels
  write to the global config for "Moi" and to the open project's config for
  "Projet".
- The work lands page by page; the frame (command bar, navigation, row
  typography) comes first because every page depends on it.

## Consequences

- Deep links to the old tab ids (`remote`, `account`, `plugins`) must map to
  their new pages.
- Pages that were one component (Plugins) become two; shared code moves to a
  helper rather than being copied.
