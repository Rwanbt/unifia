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
| `shell.workspace-tabs` | `WorkspaceTabsBar` (`components/workspace-tabs-bar.tsx:52`) | no render site in `src`; asserted absent in `a4-code-chrome` (#235), `shell.spec.ts` and `responsive.spec.ts` (this PR), quarantined as `test.fixme` in all three |
| `code.diff` | `MobileDiff` (`components/diff/mobile-diff.tsx:16`) | no render site in `src`; quarantined as `test.fixme` in #237 |

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

Three of the shell/surface failures had nothing to do with missing anchors, and
recording them matters because each looked like an anchor bug from the failure
text alone:

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
```

Those four files were 10 failures in the 2026-10-03 baseline
(`RC0-E2E-BASELINE-20261003.md`) and in the 8.4-minute measurement run
`e2e-parityA.log`. The two skips are the Class A quarantines, each carrying its
reason in the spec.

`bun x tsgo --noEmit -p e2e/tsconfig.json` reports 33 diagnostics, all
pre-existing and in other files; none in the four changed specs.

No product source is modified. QA12R is not green and not claimed.
