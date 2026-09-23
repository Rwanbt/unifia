<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-048 — User-selectable accent color

- Status: accepted
- Date: 2026-09-23
- Owner decisions 2026-09-23 (continuation of ADR-047 port)
- Related: ADR-047 (Settings structure), ADR-046 (chat observability),
  ADR-038 (visual parity scope)

## Context

The v110 maquette (`docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html`)
threads a single CSS custom property, `--accent`, through every visual
primitive that signals state: primary buttons (`.btn` background), the active
toggle (`ui-toggle.on`), sliders/progress fills, the model-pin indicator, and
hover/border derivatives via `color-mix(in srgb, var(--accent) X%, ...)`. The
maquette seeds `--accent` with `var(--text)` so the default reads as the text
colour in each scheme (white in dark, near-black in light).

The app already declares `--accent` locally inside `[data-v110="session-chat-surface"]`
(`packages/app/src/styles/v110-chat.css:55`) and reads it in five places
(v110-chat.css:97, 538, 540, 542). Two additional tokens, `--accent-base` and
`--accent-strong`, live globally in `v110.css:81-82` and are used in
`v110.css:760, 1017` — they are hard-coded rgb values, not derived from
`--accent`. The `unifia-brand.css` file holds the corporate `--unifia-indigo`
palette but is not wired into `--accent`.

There is no UI control to change the accent. `Settings.appearance` only
exposes fontSize, mono, sans.

## Decision

- The user picks one accent colour through a new control in
  `Settings > Général > Apparence` (the maquette's location).
- The value lives under `Settings.appearance.accent`, persisted through the
  existing `persisted({ key: "settings.v3", migrate })` channel. The default
  is `"inherit"` (empty string, sentinel) so a fresh install keeps the
  maquette's `--accent: var(--text)` fallback and an upgrade does not change
  rendering.
- Six presets are offered: Indigo (`#424BD5`), Crimson (`#DC2626`), Emerald
  (`#10B981`), Amber (`#F59E0B`), Violet (`#8B5CF6`), Sky (`#0EA5E9`), plus a
  custom hex picker (`<input type="color">`) and a "Suivre le texte" reset
  back to `var(--text)`.
- The bridge is a `createEffect` inside `SettingsProvider` that calls
  `document.documentElement.style.setProperty("--accent", value)` whenever the
  stored accent changes. When the value is the sentinel, the effect calls
  `removeProperty("--accent")` so the maquette seed takes over again.
- `--accent-base` and `--accent-strong` (`v110.css:81-82`) are rewritten as
  `color-mix(in srgb, var(--accent) X%, ...)` so the picker affects every
  global consumer in addition to the chat-scope ones.
- The browser `accent-color` on `:root` is also set to the same value, so
  native form controls (range inputs, progress bars, checkboxes) match.
- The corporate palette (`--unifia-indigo` et al.) in `unifia-brand.css` is
  left untouched. The picker only overrides `--accent` and its derivatives;
  logo and brand badges stay corporate.

## Consequences

- The five `var(--accent)` consumers in `v110-chat.css` start respecting the
  picker without further edits.
- `v110.css` selectors that read `--accent-base` and `--accent-strong` (lines
  760, 1017) start respecting the picker as soon as the file is updated.
- Other packages (`@unifia/ui`, `@unifia/contracts`, etc.) do not need to know
  about the picker; they continue to read CSS variables.
- The picker is web + Tauri; desktop and web render identically because the
  bridge is a runtime effect, not a build-time constant.
- A persisted store from before this ADR is migrated as if the user had
  selected "Suivre le texte" (the sentinel).

## Validation

- e2e: open Settings > Général, select "Crimson", assert that
  - the primary `Save` button background resolves to `rgb(220, 38, 38)` (or
    the closest computed match),
  - a `Switch` in the ON state shows the same colour on its track,
  - `<html>` carries `style="--accent: #dc2626;"`,
  - changing back to "Suivre le texte" removes that inline style.
- Visual: capture General > Apparence with each preset at 1440px and at
  375px, diff against the maquette baseline (golden parity suite).
