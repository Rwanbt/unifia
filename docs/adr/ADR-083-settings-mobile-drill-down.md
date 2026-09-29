<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-083 — Settings drill-down on overlay viewports, from one page list

**Status:** accepted — 2026-09-27

## Context

Settings open as a workspace destination (`SettingsSurface` → `SettingsPanel`),
which always rendered the desktop layout: on a phone the vertical tab list, an
empty content column and the page stacked underneath. The drill-down that the
reference and the responsive gate (`e2e/v110/settings-responsive.spec.ts`)
expect existed only in the legacy settings dialog, as `SettingsMobileNav`, with
its own hand-kept copy of the categories that had drifted (Remote access
instead of Compute, "Sign in" instead of Security, no groups).

## Decision

`SettingsPanel` owns both layouts and switches on the shell's viewport
authority (`useViewport`): desktop families keep the vertical tabs, overlay
families (`phone-portrait`, `tablet-portrait`, `compact-landscape`) render
`SettingsMobileNav`. The drill-down now takes the panel's `settingsGroups()`
as its only source of pages, so both layouts list the same five groups, in the
reference's order, with the same icons. It keeps the gate's slots
(`settings-mobile-nav`, `-list`, `-content`) and back button, and draws the
reference's phone list: grouped sections, two-column grid of pages.

## Rejected alternatives

- **Keep two lists and fix the mobile copy.** The drift is the bug; a second
  copy would drift again.
- **CSS only (hide the tab list, reflow the tabs as a grid).** Kobalte's
  vertical tabs keep a selected panel mounted beside the list; a real list →
  detail → back flow needs its own state.

## Consequences

`DialogSettings` renders `SettingsPanel` on every viewport. Adding a settings
page means adding it to `settingsGroups()` only.
