<!-- SPDX-License-Identifier: MIT -->
# RC-0 v110 parity anchors: what is wired, what is styled, what is declared

Measured on `dev@c40da40677` in the clean clone
`rc0-agent/.build-temp/rc0-baseline-9f69f9c` (remote repointed at GitHub; its
`node_modules` is still valid because `package.json`, `bun.lock` and
`packages/app/package.json` are unchanged since the `9f69f9c` baseline).
Logs: `e2e-parityA.log`, `e2e-chatA.log`, `e2e-shellB.log`, `e2e-surfC.log`,
`e2e-surfD.log`.

This exists because the same "styled but not rendered" pattern turned up three
times while fixing the Explorer journey (#235), the code anchors (#237) and the
shell/surface anchors (this PR). It is the RB05 / RB07 question in concrete form,
and QA12R's "every not-yet-wired capability is hidden or labelled" needs this
inventory to be decidable.

## Method, and two corrections to an earlier version of this file

Three sets were compared: `data-parity` values written in
`packages/app/src`, the values the E2E specs and `e2e/v110/parity-manifest/*.json`
expect, and — for each — whether the component carrying it is **rendered at all**.
The third question is the one a plain grep cannot answer, and it is where the
findings are.

The first version of this document reported `shell.rail` as "the element exists
but the parity key was never added". **That was wrong**, and it is worth keeping
the correction visible because the mistake was a search artefact, not a reading
error:

- `shell.rail` is present at `pages/layout/sidebar-shell.tsx:108`, written as a
  JSX expression — `data-parity={props.mobile ? undefined : "shell.rail"}`. A
  search for `data-parity="shell.rail"` cannot see it, and a search restricted to
  `*.tsx` attributes systematically misses this form.
- The same regex also missed `code.editor`, which is an object literal
  (`"data-parity": "code.editor"`, `file-tabs.tsx:197`).

So the lesson from this file is not "some anchors are missing" but "**absence of a
match is not absence of the anchor**". Both false negatives were corrected by
reading the element itself.

## Class A - the component exists but is never rendered

Carried by components that are exported and never mounted. The only references to
each are its own definition, comments, and unit tests that read the file as text.
Styled in `v110.css`, listed in the parity manifest, absent from the DOM.

| Anchor | Component | Evidence |
|---|---|---|
| `shell.workspace-tabs` | `WorkspaceTabsBar` (`components/workspace-tabs-bar.tsx:52`) | no render site in `src`; asserted absent in `a4-code-chrome` (#235), `shell.spec.ts` and `responsive.spec.ts` (#239), quarantined as `test.fixme` in all three |
| `code.diff` | `MobileDiff` (`components/diff/mobile-diff.tsx:16`) | no render site in `src`; quarantined as `test.fixme` in #237 |
| `home.glance` / `home-glance-cell` | none — never implemented | no `data-v110="home-glance*"` anywhere in `src`, and no `home.glance` entry in `parity-manifest/`; `anchors.spec.ts:15` lists the anchor but asserts `toBeGreaterThanOrEqual(0)`, which cannot fail, so nothing caught the gap. Quarantined as `test.fixme` (3 tests) |

These are declared-but-unwired capabilities, not stale selectors, so the
assertions were quarantined with that reason rather than replaced by an assertion
of current output.

## Class B - the surface is rendered under a different key

`work.shell` is expected by `surfaces.spec.ts:29` and by
`parity-manifest/work.shell.json` (`app.selector = div[data-parity="work.shell"]`).
The Work view element is

```jsx
// packages/app/src/pages/workbench/work-surface.tsx:122
<div data-v110="work-view" data-workbench-surface="work" data-parity="work.surface">
```

and the manifest's own `reference.selector` for that anchor is `div.work-view` —
i.e. the manifest and the product point at **the same element**, under different
parity-key names.

The evidence decides which side is stale:

- `work.surface` is what the product ships **and** what a passing unit test pins
  (`session-workspace-layout.test.ts:166`, which runs inside the required
  `unit (linux)` / `unit (windows)` suites).
- `work.shell` appears in exactly two places: the manifest and the one spec. No
  element, no CSS rule and no unit test uses it.
- The manifest id cannot simply be renamed: `parity:manifest:check`
  (`scripts/parity/manifest-check.ts`) cross-references each manifest `id` against
  `parity/state-policy.json` and `parity/style-profiles.json`, and it also checks
  that every app `data-parity` anchor is either fragmented or recorded in
  `parity/manifest-findings.json`.

So the spec now asserts the shipped, unit-tested key `work.surface`, and
`parity-manifest/work.shell.json` is deliberately **left untouched** — the
manifest/shipped-key divergence is a parity-coverage question for RB05, not
something to erase from one side.

`parity:manifest:check` currently exits 1 on this worktree, reporting seven
"app marker not present in the census" fragments. That is not a product finding:
`parity/artifacts/census-static.json` does not exist in the checkout, so the
census the gate reads has never been generated here. Generating it
(`bun run parity:census`) is a prerequisite before that gate can say anything, and
the gate is not one of the seven required checks.

## Not anchor problems at all

Six of the failures in the same measurement batch had nothing to do with missing
anchors, and recording them matters because each looked like an anchor bug from
the failure text alone. Two more arrived with the `home.glance` quarantine:

- **`editor-search` could not find the editor tab.** The tab element is
  `<button role="tab">` (`session-editor-surface.tsx:222`) and an explicit role
  overrides the implicit one, so `getByRole("button", { name: "file-tree.tsx" })`
  can never match it. The measured page shows `tab "file-tree.tsx" [selected]`.
  `e2e/files/file-tree.spec.ts` already used `getByRole("tab", …)` on the very
  same element.
- **The Playwright accessibility snapshot contains no `data-*` attributes.** I
  read the `editor-search` error context looking for `data-v110="code-tab"`,
  found zero occurrences, and briefly concluded the editor surface was not
  mounted — when the tab was plainly there in the snapshot as
  `tab "file-tree.tsx"`. Attribute absence in an a11y snapshot says nothing about
  the DOM. That is the third distinct way a search misled me in this area, after
  `git grep` and the JSX/object-literal forms.

The four from #239, for completeness:

- **`shell.inspector` reported "hidden".** The `<aside data-parity="shell.inspector">`
  was in the DOM and correct; the Inspector pane mounts closed
  (`data-v110="inspector-content"` carries `aria-hidden`/`inert` while closed and
  the frame's tabpanel is `hidden={!open}`). The spec has to open the pane
  through `[data-v110="inspector-toggle"]` before "visible" means anything.
- **The rail width assertion expected `78px`.** The product is internally
  consistent at `62px`: `v110.css:20` declares `--v110-rail: 62px` and
  `sidebar-shell.tsx:113` falls back to `var(--v110-rail, 62px)`. Only the spec
  was stale, which is why its topbar twin (48px, `v110.css:12`) passed.
- **`shell.rail` is not a responsive-matrix anchor.** `sidebar-shell.tsx:108`
  emits `data-parity` only when `props.mobile` is false, so on the phone and
  compact-landscape families the element does not exist. Substituting it for the
  dead `workspace-tabs` key was measured to fail with "Received: hidden" on the
  first narrow viewport, and was backed out.

## Result of this PR

```
bun run test:e2e:local -- e2e/v110/chat.spec.ts e2e/v110/shell.spec.ts \
  e2e/v110/surfaces.spec.ts e2e/v110/responsive.spec.ts
 16 passed (52.5s)
 2 skipped
exit 0

bun run test:e2e:local -- e2e/v110/home-glance.spec.ts e2e/v110/editor-search.spec.ts
 2 passed (35.7s)
 3 skipped
exit 0
```

The first four files were 10 failures in the 2026-10-03 baseline
(`RC0-E2E-BASELINE-20261003.md`) and in the 8.4-minute measurement run
`e2e-parityA.log`; the second adds 4 more closed (3 quarantined, 1 fixed). The
skips are the Class A quarantines, each carrying its reason in the spec.

Still red in the same measurement batch (`e2e-batch2A.log`, 16 failures over 8
specs): `settings-keybinds` (4), `settings-behavior` (3), `settings-responsive`
(1), `port-gate` (5), `canvas-import` (1), `canvas-layers` (1). Each needs its own
root-cause pass. The `port-gate` question is recorded below.

### settings-keybinds: three measured causes, two closed

Diagnosed with a throwaway probe spec (created, run, deleted in the clone; never
committed) that captured a keybind and dumped `localStorage` and the toast
surface. The probe measured, for each id, the shipped default and whether a
candidate combination is accepted:

| id | shipped default | free combination that persists |
|---|---|---|
| `session.new` | `Ctrl+Shift+S` | `mod+shift+j` |
| `file.open` | `Ctrl+P` | `mod+shift+g` |
| `terminal.toggle` | `` Ctrl+` `` | `mod+shift+u` |

- **The settings surface is not a dialog.** It is
  `<div data-v110="settings-frame">` (`dialog-settings.tsx:179`) with no
  `role="dialog"`, and `openSettings` returns that frame for both layouts — "with
  a project open, settings render in the workspace (beside the chat); without one
  they open as a dialog. Both hold the same settings frame" (`e2e/actions.ts`).
  The `getByRole("dialog")` assertions were therefore asserting an element that
  cannot exist. **Closed.**
- **The `file.open` default is `mod+P`, not the maquette's `Ctrl+K`.**
  `session-header.tsx:149-155` records the same decision for the sibling control:
  the maquette's "Rechercher, agir ou ouvrir... Ctrl K" was a general palette, and
  the app shows "the actual keybind rather than a 'Ctrl K' label that would not
  work". **Closed.**
- **The specs picked combinations that are already assigned.** Measured:
  `mod+shift+n` answers "Ctrl+Shift+N is already assigned to New folder", and
  `settings-keybinds.tsx:236-245` shows a conflict toast and returns *without*
  calling `set`, so nothing is persisted. The old assertion
  `expect(label).toContain("N")` passed anyway, because the row label is
  "New session..." and already contains the letter N — a vacuous pass on top of a
  refused capture. Same shape for the terminal row ("Toggle terminalCtrl+Y"
  contains "Y"). Replaced with combinations measured to be free, and the label
  assertion now checks the rendered key part ("Shift+J"), which the row title
  cannot satisfy. **Closed.**

That takes `settings-keybinds.spec.ts` from 4 failures to 2, verified in the same
conditions (`bun run test:e2e:local -- e2e/settings/settings-keybinds.spec.ts` =
8 passed / 2 failed, 3.6 min).

### The two settings-keybinds failures left open, and why

- **`:195` "changing new session keybind works"** now changes and persists the
  keybind correctly; the failure moved to the end, where pressing the new shortcut
  is expected to leave the current session
  (`expect(newUrl).toMatch(/\/session\/?$/)`, the URL still carries the old
  session id). Whether `session.new` should still navigate away from the current
  session is a product-behaviour question about a released shortcut, not a
  selector problem, and it is not settled here.
- **`:289` "changing terminal toggle keybind works"** fails inside
  `waitTerminalReady` at `actions.ts:133` — `terminalReady` never becomes true.
  That is the **same terminal-readiness blocker** as the seven terminal specs
  `playwright.config.ts:20-30` excludes from CI, and the reason the sibling test
  right below it is `test.skip(!!process.env.CI, "Flaky on ubuntu-latest:
  waitTerminalFocusIdle exceeds 90s")`. The keybind half of that test is now
  correct; the terminal half is not this spec's to fix.

### port-gate: which control is the narrow-viewport drawer toggle?

`port-gate.spec.ts:78-82` looks for a button named "Toggle menu" (or "Basculer le
menu") below the rail breakpoint, with the comment "under the shell breakpoint
the rail lives in the closed drawer. Open it through the menu toggle". The label
still exists — `sidebar.menu.toggle` = "Toggle menu" / "Basculer le menu" — but it
is on `data-v110="mobile-context-toggle"`, which is wrapped in `shell:hidden`
(`titlebar.tsx:177` and `:191`). In shell mode the visible control is
`data-v110="rail-toggle"` labelled `command.rail.toggle` = "Toggle mode rail" /
"Afficher / masquer la barre de modes".

So the question is whether the narrow-viewport affordance was renamed (the test
should follow the shipped control) or genuinely dropped in shell mode (a product
gap) — and that needs the `shell` class breakpoint and the drawer's own
visibility measured at 701/768/899 px, which this file does not yet do. Not
guessed.

`bun x tsgo --noEmit -p e2e/tsconfig.json` reports 33 diagnostics, all
pre-existing and in other files; none in the four changed specs.

No product source is modified. QA12R is not green and not claimed.
