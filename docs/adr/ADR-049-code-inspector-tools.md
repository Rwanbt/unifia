<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-049 — The Code inspector's seven tools

- Status: accepted
- Date: 2026-09-23
- Related: ADR-047 ("visual + greyed" where no backend exists), ADR-048

## Context

In Code mode the maquette's Inspector tab is not a property card: it is a
code inspector with a sub-navigation — Overview, Symbols, Search, Review,
Git, Context, History (`showCodeInspector()`, reference lines ~23749-23800).
The app had a placeholder of that navigation over mock cards, then lost it
when the Inspector tab was aligned on the note cards the reference shows in
its default state.

## Decision

`pages/session/code-inspector/` owns the Code inspector: one file per tool
plus the navigation. Each tool reads the app's real sources when the
backend has one, and follows ADR-047's "visual + greyed" rule otherwise:

- Overview: LSP servers (`lsp.status`), problems (`LspDiagnostics`), changed
  files (session diffs); detected tasks and test counts are greyed.
- Symbols: the active file's outline (`lsp.documentSymbol`); LSP actions
  greyed.
- Search: text (`find.text`) and symbol (`find.symbols`) search; "Related"
  greyed.
- Review: the existing session review panel.
- Git: `components/source-control.tsx`, whose logic is kept and whose
  render takes the reference's cards (it was mounted nowhere).
- Context: the session's context metrics and the composer's pinned files.
- History: the session's user turns as restore points, restoring through
  the session's own revert mutation.

The heading follows the tool ("Code · Source Control").

## Consequences

The other modes keep their card inspectors. New UI strings ship in English
and French; other locales fall back to English until translated.
