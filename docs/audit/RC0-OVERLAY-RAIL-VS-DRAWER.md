<!-- SPDX-License-Identifier: MIT -->
# The shell puts the rail on screen at overlay viewports, and the gate is right to fail

Measured on `dev@febeecb5048` in the clean clone, Windows Chromium, workers 1,
retries 0. The probe was a throwaway spec, created, run and deleted; it is not in
any diff. It is the largest actionable cluster in the suite: **5 of 5** `port-gate`
blocks fail in CI, plus `a3-shell-mobile:23` locally, all on the same defect.

## What the contract says

`packages/app/src/tokens/viewport.ts` is the authority, and the e2e gate already
imports it (`port-gate.spec.ts:27`) rather than restating it:

```ts
export const WIDE = 1200
export const COMPACT = 900
export const PHONE_PORTRAIT = 700

export function side(id: Viewport): Side {
  if (id === "desktop-wide") return "grid"
  if (id === "desktop-compact") return "single"
  return "overlay"
}
```

`overlay` means the rail is not on screen. The gate's own comment states the
intent plainly (`port-gate.spec.ts:28-32`):

> Below it RESPONSIVE-MATRIX puts the rail inside the (closed) drawer; the modes
> stay reachable through the titlebar menu toggle, so the gate opens the drawer
> and asserts the same contract.

## What the product does

`titlebar.tsx` renders **two different toggles for two different pieces of state**:

```tsx
// line 180 / 194 — mobile-context-toggle → layout.mobileSidebar.toggle, class="shell:hidden"
<Button data-v110="mobile-context-toggle" onClick={layout.mobileSidebar.toggle} … />

// line 217 — rail-toggle → layout.rail.toggle, class="hidden shell:flex"
<Button data-v110="rail-toggle" onClick={() => { layout.hover.rail.cancel(); layout.rail.toggle() }} … />
```

Measured geometry, session loaded, resizing in place:

| viewport | `classify` | `side` | `mobile-context-toggle` | `rail-toggle` | `[data-v110=rail]` |
|---|---|---|---|---|---|
| 1200×900 | desktop-wide | grid | 0×0 | 31×31 | 62px on screen |
| 1024×768 | desktop-compact | single | — | — | on screen |
| **768×1024** | tablet-portrait | **overlay** | **0×0** | **32×31** | **58px on screen** |
| **899×1000** | tablet-portrait | **overlay** | **0×0** | **32×31** | **58px on screen** |
| **701×1024** | tablet-portrait | **overlay** | **0×0** | **32×31** | **58px on screen** |
| 390×844 | phone-portrait | overlay | 38×38 | 0×0 | 0×0 |

At every `overlay` viewport **except the narrowest phone**, the product shows the
rail and hides the drawer toggle. `documentElement.scrollWidth - clientWidth` is
**0** at all six widths, so nothing overflows: the rail is not spilling, it is
deliberately rendered where the contract says it should not be.

## The actual root cause: the `shell:` container was never declared

The two toggles are switched by Tailwind container variants:

```tsx
// line 180 / 194 — mobile-context-toggle
<div class="shell:hidden w-10 shrink-0 flex items-center justify-center">

// line 214 — rail-toggle
<Tooltip … class="hidden shell:flex shrink-0">
```

`@container` rules exist in this repo for `getting-started` (`index.css:42`),
`design-canvas` (`v110-design.css:781`) and one unnamed case
(`v110-chat.css:695`). A search across every `.css`, `.tsx` and `.ts` in
`packages/app` finds **no `container-name: shell` and no `@container shell`**
anywhere. The only `container-type` declarations in the whole package are
`v110-chat.css:261` and `index.css:41`.

So `shell:hidden` and `shell:flex` resolve against whatever unnamed container
happens to be nearest, or against no container at all — which is why the measured
widths are not a clean breakpoint. At 390px the variants happen to resolve the
way the author intended; at 768/899/701 they do not. The measured flip between
390 and 701 is the *absence of the intended contract*, not a designed breakpoint.

This also explains why the geometry is `0×0` rather than `display: none` in some
measurements and `display: inline-flex` in others: the parent `div` keeps
`inline-flex` while its `shell:hidden` child rule never applies, so the button
collapses to zero width inside a flex row rather than being removed.

**The `shell:` variant is a no-op in this codebase.** That is the bug, and it is
a product fix with an unambiguous shape: declare the container the variant
already assumes, and pin its width to the authority the codebase already has
(`COMPACT = 900` in `tokens/viewport.ts`, which the gate's `RAIL_MIN_WIDTH`
already mirrors).

## The failure this produces

```
Error: edge-gap-899x1000: narrow viewports must expose the drawer toggle
expect(locator).toBeVisible() failed
Error: element(s) not found
```

on `port-gate.spec.ts:82`, for all three of `edge-gap-899x1000`,
`edge-tablet-701` and `edge-tablet-701`-adjacent cases. The gate looks for
`Toggle menu` / `Basculer le menu`, which is the `mobile-context-toggle` label —
measured at `0×0`.

This is also what makes the `e2e (linux)` job time out rather than report: five
blocks x two retries at ~60s each, all on this one defect.

## What is NOT the cause, because it was measured and refuted

- **Not a stale or duplicated toggle.** The button is present in the DOM at every
  width, with the right `aria-label` and a live `aria-expanded`. It is
  `0×0` because the `shell:` container query resolved against a wide container,
  not because it is absent.
- **Not `RAIL_MIN_WIDTH` being a wrong number.** It is `900`, which equals
  `COMPACT` exactly. Re-deriving the branch from `side(classify(w, h))` instead
  of `w >= 900` produces an identical decision on all nine WAVE05-adjacent cases
  checked, including the `844×390` compact-landscape row. The constant is a
  duplicate of the authority, worth importing, but it is not the defect.
- **Not overflow.** Root horizontal overflow is 0 at every width, so the "A2-04
  layout escape" reading does not apply — this is the opposite failure, content
  that should be hidden and is not.

## The decision this needs

The container fix above is mechanical and I can do it. What I cannot decide alone
is the **visible outcome at 768–899px**, because the measurement found that the
`shell:` variant was never wired, so the current tablet layout is not necessarily
what the maquette intended — it is simply what falls out of a no-op:

1. **Declare the container and honour the contract.** Add the `shell` container
   and a `@container shell (max-width: 900px)` rule so `shell:hidden` /
   `shell:flex` behave as written. This makes the tablet view switch to the
   drawer, which is what `side() = overlay` and the gate both say should happen.
   It changes what a tablet-portrait user sees at 768–899px — the range that sits
   between the compact-landscape measurement in
   `RC0-COMPACT-LANDSCAPE-MAIN-COLLAPSE.md` and the phone layout.
2. **Declare the container at a width that keeps today's tablet look**, if the
   maquette meant the rail to persist on tablets. Same code change, different
   threshold — and it makes the gate's `RAIL_MIN_WIDTH = 900` wrong rather than
   the product.

The code is the same either way. The only open question is the threshold, and
that is a visual decision for the owner: **does the rail persist on a 768px
tablet, or does it collapse into the drawer?** I am not guessing an answer to a
question about what the product should look like.

I did not apply either. Declaring the container is a one-line CSS change whose
*visible effect* is the decision above, so landing it would be shipping a
behaviour choice disguised as a plumbing fix.

`a3-shell-mobile:23` is a **separate** mechanism despite the related wording: it
measures the rail drawer at `x = 0` where the test requires `x < 0`, which is the
drawer's off-canvas geometry, not its visibility. It should not be assumed to be
fixed by either option above — the same missing container plausibly affects it,
but that needs its own measurement.
