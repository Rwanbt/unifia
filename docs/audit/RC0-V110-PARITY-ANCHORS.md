<!-- SPDX-License-Identifier: MIT -->
# RC-0 v110 parity anchors: what is wired, what is styled, what is declared

Measured on `dev@09af0ed0f6` in the clean clone
`rc0-agent/.build-temp/rc0-baseline-9f69f9c` (remote repointed at GitHub; its
`node_modules` is still valid because `package.json`, `bun.lock` and
`packages/app/package.json` are unchanged since the `9f69f9c` baseline).
Logs: `e2e-parityA.log`, `e2e-codeB.log`, `e2e-codeC.log`.

This exists because the same "styled but not rendered" pattern turned up twice
while fixing the Explorer journey (#235) and the code-surface anchors. It is the
RB05 / RB07 question in concrete form, and QA12R's "every not-yet-wired
capability is hidden or labelled" needs this inventory to be decidable.

## Method

Three sets, compared:

1. `data-parity` values actually written in `packages/app/src` - 21.
2. `data-parity` values the E2E specs and `e2e/v110/parity-manifest/*.json`
   expect - 18.
3. For each value, whether the component that carries it is **rendered at all**.

Step 3 is the part a plain grep cannot answer, and it is where the real findings
are. Two search caveats cost time here and are worth recording: `git grep`
returns nothing in these Windows worktrees (`.gitattributes` sets
`text=auto eol=lf`), and an attribute written as an object literal
(`"data-parity": "code.editor"` in `file-tabs.tsx:197`) is invisible to a search
for `data-parity="code.editor"`. `code.editor` was wrongly reported absent twice
before being read directly out of `file-tabs.tsx`.

## Class A - the component exists but is never rendered

Two anchors are carried by components that are exported and never mounted. The
only references to each are the component's own definition, comments, and unit
tests that read the file as *text*. So the anchor is styled in `v110.css`, listed
in the parity manifest, and absent from the DOM at runtime.

| Anchor | Component | Evidence |
|---|---|---|
| `shell.workspace-tabs` | `WorkspaceTabsBar` (`components/workspace-tabs-bar.tsx:52`) | no render site in `src`; asserted absent in `a4-code-chrome`, quarantined as `test.fixme` in #235 |
| `code.diff` | `MobileDiff` (`components/diff/mobile-diff.tsx:16`) | no render site in `src`; asserted absent in `code.spec.ts`, quarantined as `test.fixme` in this PR |

Both are declared-but-unwired capabilities, not stale selectors, so the
assertions were quarantined with that reason rather than replaced by an assertion
of current output.

## Class B - the surface is rendered under a different key

`work.shell` is expected by `surfaces.spec.ts:29` and by
`parity-manifest/work.shell.json` (`app.selector = div[data-parity="work.shell"]`,
`count: 1`). The rendered Work surface carries `data-parity="work.surface"`
(`pages/workbench/work-surface.tsx`) and its content region carries
`work.content` (`work-surface.tsx:152`). There is no `work.shell` anywhere.

This is a rename or a missing marker, and the two are not equivalent:

- Update the spec and the manifest to `work.surface` - the surface is rendered,
  so the spec would be asserting the shipped key.
- Wire `data-parity="work.shell"` onto the Work surface to make the manifest true -
  a product change, and it would put two parity keys on one element.

Not decided here. `RB05`'s truth table of visible controls and `RB07`'s hide-or-label
rule are the owner decisions that settle it, and `DECISIONS.md` is explicit that
removing wiring is a goal regression, so this is not a call to make silently.

## Class C - the element exists but the parity key was never added

`shell.rail` is expected by `shell.spec.ts:18`, `shell.spec.ts:34`,
`shell.spec.ts:57` and `parity-manifest/shell.rail.json`, and by
`anchors.spec.ts:18`. The mode rail itself **is** rendered - `sidebar-shell.tsx:105`
carries `data-component="sidebar-rail"` and `context/layout.tsx:184` queries that
same selector - but no `data-parity="shell.rail"` exists. The element is there;
the parity key is missing.

That is a one-attribute product change rather than a spec change, but it is still
a product change, and it lands in the same owner-decision bucket as Class B.

## What this PR fixes, and what it does not

Fixed and verified here: `v110/code.spec.ts` (3 failures to 3 passes, 1 skipped).
Its header already stated the precondition - "a project + session with an open
editor" - but the body never established it. `data-parity="code.editor"` is
written on the file-tab content element (`file-tabs.tsx`), which only renders for
a tab that has a path, and the Chat/Split/Editor switch owns whether the editor
surface exists. The spec now walks the same path as
`e2e/files/file-tree.spec.ts` and `e2e/v110/a4-code-chrome.spec.ts` via the
existing `openInspector` helper, and uses `gotoSession()` rather than
`project.open()` because the latter creates a throwaway project directory with no
source tree in it - there would be no `packages/app/src/components` to walk.

```
bun run test:e2e:local -- e2e/v110/code.spec.ts
 3 passed (36.1s)
 1 skipped
```

Not fixed here: `v110/chat.spec.ts` (2), `v110/shell.spec.ts` (4),
`v110/surfaces.spec.ts` (3), `v110/responsive.spec.ts` (1). Ten failures, all
measured in one 8.4-minute run (`e2e-parityA.log`). Six of them depend on the
Class B / Class C decisions above (`work.shell` and `shell.rail` account for the
`surfaces` work/automate pair and the whole `shell` file), so fixing them before the
decision would mean guessing at the intended contract.

No product source is modified. QA12R is not green and not claimed.
