<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-059 — Memory note editor, ported from the reference on real data

**Status:** accepted — 2026-09-28

## Context

The reference's Memory note pane (`.note-pane`, V5 prototype) has a 44px
toolbar (note history, save state, context toggle, Edit/Preview/Split, note
actions, links toggle) and a document with a path line, a title, a meta row
(tags, type, modified, confidence), and in Edit/Split a title field, a tags
field and a body editor. The app's pane showed a save chip, a Preview/Edit/
Split switch and a Save button over a raw Markdown textarea. Its preview
printed the tag line and the `[[wikilinks]]` as plain text.

## Decision

Port the pane at the reference's measured values, wiring each control to a
real capability:

- **History.** Back and forward walk the notes opened in this panel.
- **Save chip.** The chip is the save button: it flushes the draft when it is
  unsaved. Autosave (700 ms) is unchanged.
- **Attached / Context.** Adds or removes the note as a file in the prompt
  context (`prompt.context`), the same mechanism the editor uses for files.
- **Note actions (…).** Opens the vault's existing note menu.
- **Edit fields.** The title field rewrites the note's `# heading`. The tags
  field rewrites one tag-only line (`#a #b`) under it. The body editor edits
  the rest. Frontmatter and every untouched byte are kept.
- **Meta row.** Tags, and the modified date from the file stamp's `mtime`.
- **Preview.** Omits the tag line (it is the meta row) and renders
  `[[wikilinks]]` as links that open the note.

The reference's Verified/Project badges, note type and confidence have no
runtime source and are not shown. A note whose read returns no text now shows
the pane's own read error instead of crashing the app.

## Consequences

The Markdown helpers live in `memory-panel-model.ts` as pure functions with
round-trip tests. A note written by hand keeps its layout: the editor never
normalizes what it did not change.

## Addendum — phones (2026-09-28)

On phones the reference keeps the note on screen and opens the vault (‹, 320px)
and the links (›, 310px) as drawers over it, with a scrim. The app used to
swap one pane for another and started on the vault; it now follows the
reference: every layout opens on a note, the toolbar chevrons toggle the
drawers, the scrim or the drawer's own chevron closes them, and opening a
note closes the drawer. The reference's Note/Graph selector lives in its
top bar; on phones it sits beside Edit/Preview in the note toolbar, and
Graph shows the depth-N graph in place of the note. The graph renderer moved
to `memory-graph.tsx` so the links pane and the Graph view share it, each
with its own pan and zoom.
