<!-- SPDX-License-Identifier: MIT -->
# The port gate asserted a rail/drawer breakpoint the product never had

Measured on `dev@45245abf13` in the clean clone, Windows Chromium, workers 1,
retries 0. The probes were throwaway specs, created, run and deleted; none is in
any diff. This closed **4 of 5** failures in `v110/port-gate.spec.ts`, which was
the largest actionable cluster in the suite: 5 of 5 blocks failed in CI, which is
also what made the `e2e (linux)` job hit its 1h51 timeout instead of reporting.

> **Correction.** An earlier revision of this document concluded that the
> `shell:` container variant had never been declared and was therefore a no-op,
> and that the product was wrong. Both halves were wrong. `layout.tsx:1056`
> renders `<div class="@container w-full h-full">`, which is the unnamed container
> the `shell:` variants resolve against — declaring a `container-name: shell` on
> `shell-frame` was measured and changed **nothing** (`display: contents` at
> 1200, 62px rail, mobile toggle 0×0, identical before and after). And the
> product was right about the rail: the reference keeps a real rail on portrait
> tablets. The defect was entirely in the harness. The measured refutation is
> kept below rather than deleted, because "I measured it and it changed nothing"
> is the useful part.

## The three harness defects

**1. A hardcoded breakpoint that contradicts the contract.**
`port-gate.spec.ts` carried `const RAIL_MIN_WIDTH = 900` and branched on
`c.width >= RAIL_MIN_WIDTH`, while the file two lines above it already imported
`classify` from `tokens/viewport`. `900` is `COMPACT`, but `COMPACT` is the
*grid* breakpoint, not the rail's. The rail survives well past it.

The reference is explicit (`docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html`),
hiding `#rail` in exactly three blocks:

```css
@media (max-width:599px)                        { #rail{display:none !important} }
@media (max-height:520px) and (max-width:899px) and (orientation:landscape) { … }
@media (max-width:700px) and (orientation:portrait) { #rail{display:none!important} }
```

and the product's own stylesheet says the same about the middle range
(`v110.css:849-853`): *"Compact desktops, 900-1199px (ADR-053) — **a 58px rail**
10px from the edges"*. The measured rail width is 58px at 899, 768 and 701 —
exactly what that comment promises.

**2. `modes()` cannot work when the rail is folded away.** It opened with

```ts
const rail = page.locator('[data-component="sidebar-rail"]:visible').first()
await expect(rail).toBeVisible()
```

but on a phone the rail is not a visible `sidebar-rail` at all. Measured at
390×844 with the drawer open: `sidebar-rail` present **1, visible 0**, while
`[data-v110="mobile-nav"]` carries the four `data-mode` buttons at 53×48. This is
what failed the "wide breakpoints" group, whose four viewports include two
phones and a compact landscape — a group that never reaches the drawer assertion.

**3. The console gate cannot name its own exceptions.** `expect(t.logs).toEqual([])`
sees only `msg.text()`, and Chromium reports every failed resource with the same
line and no URL. Both `port-gate` gates now use `trackFailingRequests` from #265,
which records `status method URL` and tolerates only the two documented harness
404s.

## Ground truth, all 16 WAVE05 viewports

| viewport | id | rail px | menu toggle | `dockedRail(id)` |
|---|---|---|---|---|
| desktop-1440x900 | desktop-wide | 62 | no | rail |
| desktop-1280x800 | desktop-wide | 62 | no | rail |
| compact-1024x768 | desktop-compact | 58 | no | rail |
| tablet-768x1024 | tablet-portrait | 58 | no | rail |
| phone-390x844 | phone-portrait | 0 | **yes** | drawer |
| phone-360x800 | phone-portrait | 0 | **yes** | drawer |
| landscape-844x390 | compact-landscape | 58 | no | rail |
| edge-wide-1200 | desktop-wide | 62 | no | rail |
| edge-wide-1199 | desktop-compact | 58 | no | rail |
| edge-compact-900 | desktop-compact | 58 | no | rail |
| edge-gap-899x1000 | tablet-portrait | 58 | no | rail |
| edge-gap-899x600 | desktop-compact | 58 | no | rail |
| edge-tablet-701 | tablet-portrait | 58 | no | rail |
| edge-phone-700 | phone-portrait | 0 | **yes** | drawer |
| edge-land-981x390 | desktop-compact | 58 | no | rail |
| edge-land-844x561 | desktop-compact | 58 | no | rail |

The rail is present everywhere except portrait ≤ 700, and the menu toggle is
present exactly there. `dockedRail(id) = id !== "phone-portrait"` matches **16 of
16**. The old rule disagreed on five: 768, 899x1000, 899x600, 701 and 844x561.

## The one place the product diverges from the reference, and why it stays

The reference's landscape rule (`max-height:520px`) has no pointer condition,
so read literally it would hide the rail at 844×390. The product keeps it, and
that is deliberate:

- the sibling rule in the same reference *does* require `pointer:coarse`, and the
  product implements that one explicitly as *"Phones held in landscape"*
  (`v110.css:622`);
- 844×390 in this matrix is a 390px-tall **desktop** window with a fine pointer;
- hiding the rail there would leave the mode buttons with no container at all,
  because the bottom nav is only rendered under the mobile sheet —
  `pages/layout.tsx:1118` passes `mobile`, `:1056` does not.

So `dockedRail` follows the portrait rules exactly and the landscape rule not at
all, and the reason is written into the function. `RC0-COMPACT-LANDSCAPE-MAIN-COLLAPSE.md`
covers the 844×390 main-pane collapse, which is a separate symptom at the same
viewport.

## Why the rail exists at all on a tablet

`sidebar-shell.tsx:103` wraps the rail in `<Show when={!props.mobile}>`, and
`layout.tsx:988` defines `const sidebarContent = (mobile?: boolean)`. The desktop
tree calls it **with no argument** at `:1056`, so `mobile` is `undefined` and the
rail is mounted whatever the viewport. The viewport never reaches the rail's
mount decision on the desktop path — which is why the container variant only
swaps the two titlebar toggles and never the rail itself.

## Still open

`a3-shell-mobile:23` measures the drawer at `x = 0` where the test requires
`x < 0`. That is off-canvas geometry, not visibility, and nothing here addresses
it.
