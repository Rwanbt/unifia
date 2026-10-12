<!-- SPDX-License-Identifier: MIT -->
# RC-0 E2E: Explorer journey, ADR-084 note editor, and one unresolved pane contract

Measured on `dev@44fa7fede6` in a clean clone (the previous session's normal clone
`rc0-agent/.build-temp/rc0-baseline-9f69f9c`, remote repointed at GitHub).
`package.json`, `bun.lock` and `packages/app/package.json` are unchanged since the
`9f69f9c` baseline, so its installed `node_modules` is still valid. Windows
Chromium, `PLAYWRIGHT_WORKERS=1`, `PLAYWRIGHT_RETRIES=0`, real backend.
Logs: `rc0-e2e-batch2.log`, `e2e-auto1.log`, `e2e-a3r1.log`, `e2e-a3r2.log`.

## 1. Seven specs could not reach the file tree (PR #235)

Every one of them opened the Explorer through a **"Toggle file tree" button that
the product does not render**, so all seven failed at their first step and none
of them ever exercised the journey they were written for.

The product side is explicit, and it is the specification:

- `command.fileTree.toggle` exists only as a command (`use-session-commands.tsx:574`).
  `session-workspace-layout.test.ts:128` asserts the session header does **not**
  contain `language.t("command.fileTree.toggle")` - the absence is intended.
  Measured header: "Toggle mode rail", "Toggle sidebar", "Toggle review",
  "Show terminal", "Open in", "Show / hide the inspector". No file-tree button.
- The tree lives in the pane opened by `data-v110="inspector-toggle"`
  (`titlebar.tsx:365`). `v110-inspector-frame.tsx` and `session-side-panel.tsx:334`
  both state "one shared pane, one tab visible at a time - no second Explorer, no
  dual-pane". The `[data-component="tabs"][data-scope="filetree"]` pill set with
  its "All files" entry is gone; `e2e/files/file-tree.spec.ts:11` already says so.
  Tabs are `data-v110-tab="explorer|inspector|execution"`.
- Opening a file does not mount the editor. The Chat/Split/Editor switch owns the
  workspace view (`data-v110="layout-switch"`), which is what the existing shared
  helper `e2e/v110/inspector.ts` already encodes. Measured: on Chat the main
  surface stays "Conversation" and no `code-tabs` header exists in the DOM.

Two further stale contracts surfaced behind that first blocker:

- `a3-responsive` targeted the composer context meter with
  `button[aria-label*="context" i]`, which also matches the topbar's
  "Create a task from the current context". At phone-portrait that hidden button
  came first in DOM order, so `.first()` asserted the wrong control. The meter has
  its own marker, `data-v110="context-meter"` (`session-context-usage.tsx:82`).
- `a4-code-chrome` asserted the terminal border from the superseded bottom-bar
  design. `v110.css:974` styles the bare panel `border-top: 1px solid var(--border-base)`,
  but `v110-editor.css:303` makes it a floating card with
  `border: 1px solid var(--v110-card-line)` and that selector has two attribute
  components against one, so it wins inside the editor surface. Measured in dark
  theme the panel resolves to `rgba(0, 0, 0, 0.067)`, exactly `--v110-card-line`
  (`v110-editor.css:86`). The cascade is correct; the assertion was stale. The probe
  must also live inside the panel, because `--v110-card-line` is declared on a
  theme/editor-surface selector and a `body`-level probe silently falls back to
  `rgb(0, 0, 0)`.

Result: those seven files went from **9 failures** in
`RC0-E2E-BASELINE-20261003.md` to 2, plus one documented `fixme`.
`a4-code-chrome` 1 failure to pass; `a3-responsive` 3 to 1.

### Quarantined, not made to pass

`WorkspaceTabsBar` (`components/workspace-tabs-bar.tsx:52`) is exported but has
**no render site anywhere in `src`**: its only other references are two unit tests
that read the file as text and two comments. So `data-component="workspace-tabs-bar"`
and the `data-parity="shell.workspace-tabs"` anchor are styled in `v110.css` but
never mounted. That is a capability declared and not wired (RB05/RB07), not a stale
selector, so the assertion was split out as `test.fixme` with that reason rather
than replaced by an assertion of current output - the convention already used by
`model-picker.spec.ts:5` and `session-review.spec.ts:374`.

## 2. The memory note editor is a three-field editor (this PR)

`memory-note-autosave` expected the note's whole file in the textarea. It is not
there. ADR-084 splits the editor and `memory-note-draft.ts` states the mapping: a
note is `front + heading + lead + tagLine + trail + body`, and "a note is never
normalized: joining the parts of any text gives that text back". The title input
(`data-memory-title-input`) owns the `# heading`; the textarea owns the `body`
slice.

For `"# Autosave\n\ninitial body\n"` there is no tag line, so `lead` collapses and
`body` is `"\ninitial body\n"` - the heading is not part of it, and the blank
separator is. The spec now asserts the title field holds `Autosave` and the
textarea holds `"\ninitial body\n"`, and fills the body slice so the heading and
separator survive. **The two on-disk assertions are unchanged**, which is the
strongest evidence the alignment is right: they were already written for this
contract and only the textarea-level expectation was on the old model.

```
bun run test:e2e:local -- e2e/v110/memory-note-autosave.spec.ts
 1 passed (26.2s)
```

## 3. Unresolved: the memory pane renders 0 visible panes at 844x390

`a3-responsive.spec.ts:137` "memory pane keeps the triptych/single-pane contract"
still fails, and it is a **different defect**. Stopping here per the
three-attempts rule; nothing below is shipped.

Two things were established by measurement:

- The size-only probe was wrong. In `single`, the vault and links panes are not
  removed: `v110-memory.css:118-129` makes them absolutely positioned overlays with
  `visibility: hidden; opacity: 0`, so they keep a non-zero box. Adding
  `visibility`/`opacity` to the criterion fixed `tablet-portrait-768x1024`
  (3 panes counted where an overlay family shows 1).
- `compact-landscape-844x390` reports **0** visible panes, and it is not a
  transition race: `expect.poll` with a 5s timeout expired on 0, while the
  `data-memory-layout` assertion on the same step passes with `"single"` and the
  panel is attached. No `@media` rule in `v110-memory.css` hides the panes at that
  size (the only width query is `max-width: 360px`; the only other query is
  `prefers-reduced-motion`).

Options, none chosen here:

1. **Measure the panel state at that viewport** and decide whether 0 panes is the
   intended short-landscape contract (the sheet is closed) or a defect. This is
   the only option that can settle it, and it needs the `data-hide-*` attributes
   and the computed height of `[data-v110="memory-grid"]` read at 844x390.
2. If 0 turns out to be intended, the spec's `OVERLAY_FAMILIES` expectation of 1 is
   wrong for that family and the test needs a documented per-family expectation
   rather than a single rule - which means the test stops being a clean contract
   check.
3. If 0 is a defect, the fix is in the product (the overlay sheet not restoring its
   content on the short-landscape reflow), which is out of scope for an E2E lot and
   belongs to a product change with its own evidence.

No product source was modified by this work. QA12R is not green and not claimed.
