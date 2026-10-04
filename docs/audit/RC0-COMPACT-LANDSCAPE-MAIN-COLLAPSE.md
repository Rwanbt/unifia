<!-- SPDX-License-Identifier: MIT -->
# RC-0 compact-landscape: the main column collapses to zero width

Measured on `dev@4dd53c61c5` in the clean clone, Windows Chromium, workers 1,
retries 0. Logs: `e2e-probe11c.log`, `e2e-probe12.log`. Both probes were
throwaway specs, created, run and deleted; neither is in the diff.

This is the finding behind `v110/settings-responsive.spec.ts:30`, which fails at
`compact-landscape-844x390` with Playwright reporting `element is not stable` for
30 s. That message is a symptom; the layout measurement is the cause.

## What was assumed, and what is true

The classification is **not** the problem. At 844x390:

```ts
// packages/app/src/tokens/viewport.ts
if (height <= LANDSCAPE_H && width <= LANDSCAPE_W && width > height) return "compact-landscape"
export function side(id: Viewport): Side {
  if (id === "desktop-wide") return "grid"
  if (id === "desktop-compact") return "single"
  return "overlay"        // compact-landscape lands here
}
```

so `side("compact-landscape") === "overlay"`, which agrees with the spec's own
`OVERLAY_FAMILIES` (it lists `compact-landscape-844x390`). The mobile nav does
mount, and all **17** of its items exist in the DOM.

## What is actually wrong

The mobile nav inherits a zero-width column. Sampled ancestor by ancestor at
844x390, after opening Settings and resizing:

| element | x | width |
|---|---:|---:|
| `session-workspace-main` | 89 | 754 |
| `mode-main` | 853 | **0** |
| `surface-card` (`workbench-settings-surface`) | 853 | 2 |
| `settings-frame` | 854 | **0** |
| `settings-mobile-nav` | 854 | **0** |
| `settings-mobile-list` | 854 | 20 |
| `settings-mobile-item` (first) | **864** | 20 |

The viewport is 844 wide, so the first nav item sits at **x=864** — entirely
outside it. `session-workspace-main` carries `shell:flex-row` and consumes 754px
from x=89, which ends at 843, leaving the main column exactly 0px. Everything
mounted in that column is therefore rendered off-screen: the settings surface, its
frame, the whole mobile navigation, and all 17 items.

A separate ten-frame sample of that item's box was **perfectly stable**
(`x: 864, y: 183.5, w: 20, h: 44` on every frame, with
`scrollWidth === clientWidth === 844` and `scrollHeight === clientHeight === 390`),
so there is no oscillation and no scrollable overflow. The document does not think
it overflows; the content is simply laid out outside the viewport and clipped. That
is why the E2E failure reads as a stability complaint rather than an overflow one,
and it is why `overflow(page)` in the same test passes: the root element reports no
x-overflow even though the control is unreachable.

## Why this matters beyond the test

A user at 844x390 (or any short landscape window) who opens Settings gets a
surface they cannot see or interact with, and there is no horizontal scroll to
reveal it. That is the RB07 "control present but not reachable" case, and it is a
QA12R blocker for the visible-control criterion, not a flake.

## What is needed, and what I did not do

The fix is not a test change: no assertion or timeout can make a 0px-wide column
clickable. It is a layout decision in the shell's `flex-row` distribution at
landscape sizes — how the session rail, the chat column and the main column should
share 844px, or whether `compact-landscape` should drop out of `flex-row` and take
the overlay sheet like the tablet and phone families do.

I did not make that change here. It is a visual/UX decision with no measurement in
this pack that says which split is correct, and the surrounding port-gate and
responsive families are still open, so guessing would be the third unmeasured
change in the same area. The measurements above are what a decision needs.

## Related open items in the same batch

Still measured, not addressed: `canvas-import:39` (the imported nodes are never
persisted: expected `{rect, rootIds, schemaVersion, text}`, read `null` after 30 s),
`canvas-layers:86` (`[data-design-layer-visibility="r"]` is absent), and
`settings-behavior:110` (the removed MCP server's row is still counted).
