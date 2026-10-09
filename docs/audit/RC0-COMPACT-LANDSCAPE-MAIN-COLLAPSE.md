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

## The mechanism, measured

`session-workspace-main` (`session.tsx:1001`, class
`flex-1 min-h-0 flex flex-col shell:flex-row` — a string a unit test pins at
`session-workspace-layout.test.ts:18`) is a flex **row** with three children at
844x390:

| child | x | width | `flex` | decisive class |
|---|---:|---:|---|---|
| `session-chat-surface` | 89 | **754** | `0 0 auto` | `… shrink-0 …` |
| `mode-main` (`workbench-mode-main`) | 853 | **0** | `1 1 auto` | `min-w-0 min-h-0 flex-1` |
| `inspector-content` | 529 | 320 | `0 0 auto` | `… shrink-0 …` |

The row is 754 wide. The chat surface and the inspector are both
`flex: 0 0 auto` and both carry **`shrink-0`**, so they keep 754 and 320 — 1074
between them, 320 more than the row has. `mode-main` is the only child that can
absorb the difference: it is `flex: 1 1 auto` **and** carries `min-w-0`, which
removes the automatic minimum size and lets it shrink to literally nothing.

So the collapse is not "the main column is too narrow". It is **the entire deficit
being routed onto the one child that is allowed to shrink**, because the other two
opt out of shrinking. The chat surface reaching 754 is itself suspicious — it is an
auto-width child in a 754 row, so it is taking its content's intrinsic width
rather than a share.

## Why I did not fix it here

The obvious-looking change — dropping `shrink-0` from the chat surface so the two
fixed columns can give way — alters the **desktop** layout, where the chat column's
fixed width is deliberate. The narrower alternative, capping the chat surface's
intrinsic width at landscape sizes, is a visual decision: nothing in this pack
states what 844x390 is supposed to look like, and the same viewport family is
still open in `port-gate` and `v110/responsive`, so a change here would be the
third unmeasured move in one area.

The measurement is what a decision needs, and this is it: **not "the main column
is too small" but "the deficit lands entirely on `mode-main` because the chat
surface and the inspector both set `shrink-0` while `mode-main` sets `min-w-0`"**,
with the exact widths at the failing viewport.

This is the RB07 "control present but not reachable" case, and it is a QA12R
blocker for the visible-control criterion, not a flake.

## Related open items in the same batch

Still measured, not addressed: `canvas-import:39` (the imported nodes are never
persisted: expected `{rect, rootIds, schemaVersion, text}`, read `null` after 30 s),
`canvas-layers:86` (`[data-design-layer-visibility="r"]` is absent), and
`settings-behavior:110` (the removed MCP server's row is still counted).
