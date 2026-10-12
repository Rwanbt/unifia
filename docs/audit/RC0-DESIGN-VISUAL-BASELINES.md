<!-- SPDX-License-Identifier: MIT -->
# The visual gate cannot be made green by regenerating its baselines

Measured on `dev@e849922c98`, Windows Chromium, workers 1, retries 0, in the clean
clone. All nine `design-visual` failures are the same thing, and the fix the test
itself suggests would make things worse.

## What the failure is

```
expect(page).toHaveScreenshot() failed
272983 pixels (ratio 0.90 of all image pixels) are different.
Snapshot: light-375.png
```

Ninety percent of pixels is not antialiasing, not a font that arrived late, and not a
one-pixel regression. It is a different page. Comparing the committed
`__screenshots__/win32/light-1280.png` with the `-actual.png` from the same run shows
the baseline is an early prototype — a "DESIGN ASSISTANT" panel, a file tree, a
placeholder preview — while the product now renders the full branded Unifia shell with
the design studio, canvas, layers and tools.

## Why they diverged, and it was not a regression

The baselines are committed with an mtime of **2026-09-29**. Three commits after that
date touch the surface or its palette, and one of them is the owner's own:

- `f0b3dd481c feat(brand): refresh the generated stylesheet` — 38 lines removed,
  2 added. It **replaces** the palette: `--surface-canvas: #f1f1f2`,
  `--surface-panel: #ffffff`, `--text-primary: #17171a` are gone, replaced by the
  Unifia night ramp `--unifia-void: #010308`, `--unifia-obsidian`, `--unifia-graphite`.
  A full palette swap changes essentially every pixel.
- `e0addec458 refactor(design): restore connection and Spec action contracts (#203)`.
- the mobile shell work merged as #253–#258.

So the deltas are intended changes. **Regenerating the baselines would be correct in
principle** — and that is exactly the trap.

## The trap: the surface paints the machine it runs on

The captured page renders the project's absolute path and its git branch.
`components/session/session-new-view.tsx` gets them from live state:

```tsx
const projectRoot = createMemo(() => sync.project?.worktree ?? sdk.directory)
const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes()])   // sandboxes -> branch names
```

Both are real environment data, and both are visible in the `-actual.png` produced
here. The left panel of that capture reads, verbatim:

```
D:/App/unifia/unifia/.worktrees/rc0-agent/.build-temp/rc0-baseline-9f69f9c
Main branch (rc0-full2)
```

`rc0-full2` is the branch of the clone that produced it; `rc0-baseline-9f69f9c` is that
clone's path.

The test's own skip message documents the remediation:

> Generate it on that platform with `bunx playwright test e2e/design/design-visual.spec.ts --update-snapshots` and commit the result.

**Run here, that command produces a baseline that fails on every other machine, every
other clone, and in CI** — because both strings are baked into the image. The
`__screenshots__/win32/` split and the "on that platform" wording look like they
acknowledge a platform constraint; the real constraint is *per clone and per branch*.

This also explains why the file `e2e/design/design-tree.spec` sorts the tree by name
"to make it deterministic": the tree's ordering depends on the path being painted.

## The two real options

**1. Pin the project identity for the visual test, then regenerate.** The surface
already has a pinning convention — `pinTime`, `ANIMATION_DISABLE_CSS`,
`installWorkbenchMock`, `markE2E` — for exactly this class of problem. The missing pin
is the project/sandbox identity, which does not come from the mock: the mock answers
`files`/`createFiles`/`removeFiles` and nothing about `sync.project`. So this means
seeding a fixed `worktree` and sandbox in the e2e backend fixture, or teaching
`session-new-view` to read a value from the existing `window.__opencode_e2e` hook when
it is set. After that, `--update-snapshots` produces a baseline that is actually
reproducible, and the gate can see new changes again.

**2. Narrow the capture to the design surface and stop painting the project panel.**
The test's subject is the design surface, not the session-new summary next to it. This
is smaller, but it drops a real assertion, and it is the same reasoning that made
#267's report untrustworthy — narrowing the thing you measure instead of fixing what
you measure. It needs the owner's agreement.

## Recommendation

Option 1. It is the only one that restores the gate rather than shrinking it, and the
`__opencode_e2e` hook already exists for exactly this purpose — `markE2E` currently
sets an empty object and nothing reads it.

Not applied here: it needs a backend fixture change plus a regenerated baseline set,
which is a larger lot than this diagnosis, and regenerating first would bake this
clone's path into eight files.

## Related

`design-visual.spec.ts:162` — "renders identically across a reload — dark" — is the
ninth failure and has a different signature: it compares a screenshot against a
screenshot in the same run (`if (!first.equals(second))`), so it says the surface is
not stable across a reload, which no baseline regeneration can fix.
