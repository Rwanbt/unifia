<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-054 — The v110 palette follows the colour scheme and the theme

- Status: accepted (owner report 2026-09-24: rail and topbar stayed dark in
  light mode; themes such as Material or Lucent Orng did not reach them)
- Date: 2026-09-24
- Related: ADR-048 (accent picker), styles/v110.css, styles/v110-theme.css

## Context

The v110 layer pinned the reference's measured greys (`--surface`,
`--bg-soft`, `--text`, ...) and the topbar/rail tokens as literal dark
values. Only some surfaces had a light override, and no theme other than
the default could change them, so the chrome ignored both the colour
scheme and the theme picker.

## Decision

- The topbar and rail tokens are derived from the v110 palette
  (`--bg-soft`, `--surface`, `--hover`, `--line`), never literals.
- `v110-theme.css` owns the palette per theme: oc-2 keeps the reference's
  measured greys (dark in `v110.css`, light in `v110-theme.css`); any other
  theme derives the palette from its own `--background-base` and
  `--text-*` tokens with `color-mix`. The scopes that redeclare the palette
  (chat surface, settings and account frames, editor card) are remapped by
  the same rule.

## Consequences

- A new surface must use the palette tokens, not hex values, or it will
  not follow the theme.
- oc-2 stays pixel-identical to the reference; other themes are an
  approximation of the reference's grey steps on the theme's colours.
